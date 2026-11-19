"""Two-player drawing sync check (manual, not part of `pnpm test`).

Prerequisites: `pnpm --filter web build` then `pnpm --filter worker dev` (port 8787).
Usage: python3 apps/web/e2e/draw-sync.py [--base http://localhost:8787] [--screenshot drawer.png] [--chrome /usr/bin/google-chrome]

Alice creates a room, Bob and Carol join, Alice starts; the word is auto-picked after
chooseSeconds (5 s). Alice draws with every tool, undoes/redoes with the keyboard,
and after each step both canvases must be pixel-identical. Finally Bob reloads and
the replayed drawing must still match.
"""
import argparse
import math
import sys

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8787')
ap.add_argument('--screenshot', default=None)
ap.add_argument('--chrome', default='/usr/bin/google-chrome')
args = ap.parse_args()

PIXELS_JS = """() => {
  const c = document.querySelector('canvas.board');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  return Array.from(d);
}"""

SUMMARY_JS = """() => {
  const c = document.querySelector('canvas.board');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let nonwhite = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) nonwhite++;
  return { url: c.toDataURL(), nonwhite };
}"""

SET_RANGE_JS = """([label, value]) => {
  const el = [...document.querySelectorAll('.tb-range')].find((l) => l.textContent.startsWith(label)).querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}"""

failures = []


def init_script(name, extra=''):
    return f"localStorage.setItem('kg.name', {name!r});{extra}"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome)
        ca = browser.new_context(viewport={'width': 1200, 'height': 1100})
        cb = browser.new_context(viewport={'width': 1000, 'height': 900})
        ca.add_init_script(init_script('Alice', "localStorage.setItem('kg.pictionarySettings', JSON.stringify({chooseSeconds: 5, drawSeconds: 240}));"))
        cb.add_init_script(init_script('Bob'))
        # A third player keeps the game alive while Bob reloads (< 2 connected ends it).
        cc = browser.new_context(viewport={'width': 1000, 'height': 900})
        cc.add_init_script(init_script('Carol'))
        a = ca.new_page()
        b = cb.new_page()
        for pg, who in ((a, 'A'), (b, 'B')):
            pg.on('pageerror', lambda e, who=who: failures.append(f'{who} page error: {e}'))

        a.goto(args.base + '/')
        a.get_by_role('button', name='Créer une salle').click()
        a.wait_for_url('**/pictionary/*')
        url = a.url
        print('room', url)
        b.goto(url)
        c = cc.new_page()
        c.goto(url)
        a.get_by_text('Bob').first.wait_for()
        a.get_by_text('Carol').first.wait_for()
        a.get_by_role('button', name='Lancer la partie').click()
        a.locator('.toolbar').wait_for(timeout=15000)
        b.locator('canvas.board').wait_for()
        assert b.locator('.toolbar').count() == 0, 'guesser must not see the toolbar'

        board = a.locator('canvas.board')
        box = board.bounding_box()

        def at(x, y):
            return box['x'] + x / 800 * box['width'], box['y'] + y / 600 * box['height']

        def drag(points, steps=8):
            a.mouse.move(*at(*points[0]))
            a.mouse.down()
            for pt in points[1:]:
                a.mouse.move(*at(*pt), steps=steps)
            a.mouse.up()

        def click(x, y):
            a.mouse.click(*at(x, y))

        def tool(name):
            a.locator(f'[data-tool="{name}"]').click()

        def color(hex_):
            a.get_by_role('button', name=f'Couleur {hex_}').click()

        def compare(label, page_b=b):
            a.wait_for_timeout(400)
            sa, sb = a.evaluate(SUMMARY_JS), page_b.evaluate(SUMMARY_JS)
            diff = 0
            if sa['url'] != sb['url']:
                pa, pb = a.evaluate(PIXELS_JS), page_b.evaluate(PIXELS_JS)
                diff = sum(1 for i in range(0, len(pa), 4) if pa[i:i + 4] != pb[i:i + 4])
                failures.append(label)
            status = 'OK ' if sa['url'] == sb['url'] else 'FAIL'
            print(f"{status} {label}: {diff} differing px, {sa['nonwhite']} non-white px on drawer")
            return sa['nonwhite']

        # Pen, black, size 6
        tool('pen')
        drag([(60, 60), (200, 120), (300, 60), (380, 160)])
        compare('pen stroke')

        # Long spiral: > 2000 points, must split into several strokes
        color('#1565c0')
        a.evaluate(SET_RANGE_JS, ['Taille', 3])
        spiral = [(600 + math.cos(t / 40) * (20 + t / 30), 420 + math.sin(t / 40) * (20 + t / 30)) for t in range(0, 2300)]
        drag(spiral, steps=1)
        compare('2300-point spiral')

        # Semi-transparent overlapping stroke
        color('#e53935')
        a.evaluate(SET_RANGE_JS, ['Taille', 24])
        a.evaluate(SET_RANGE_JS, ['Opacité', 40])
        drag([(80, 300), (300, 260), (120, 220), (320, 340)])
        compare('40% opacity stroke')

        # Keyboard tool switches from here on
        a.evaluate(SET_RANGE_JS, ['Opacité', 100])
        a.evaluate(SET_RANGE_JS, ['Taille', 6])
        color('#2e7d32')
        a.keyboard.press('r')
        drag([(420, 60), (700, 220)])
        compare('rect outline')

        a.keyboard.press('o')
        color('#fdd835')
        a.locator('.tb-check input').check()
        drag([(60, 400), (300, 560)])
        compare('filled ellipse')

        a.keyboard.press('l')
        color('#7e57c2')
        drag([(40, 590), (780, 380)])
        compare('line')

        a.keyboard.press('f')
        color('#ff8a80')
        click(560, 140)
        compare('fill inside rect')

        a.keyboard.press('e')
        a.evaluate(SET_RANGE_JS, ['Taille', 30])
        drag([(50, 90), (400, 90)])
        compare('eraser')

        if args.screenshot:
            a.screenshot(path=args.screenshot, full_page=True)

        full = compare('before undo')
        a.keyboard.press('Control+z')
        a.keyboard.press('Control+z')
        undone = compare('ctrl+z x2')
        a.keyboard.press('Control+y')
        compare('ctrl+y')
        a.keyboard.press('Control+Shift+z')
        redone = compare('ctrl+shift+z')
        if not (undone != full and redone == full):
            failures.append(f'undo/redo did not change the drawing as expected ({full}, {undone}, {redone})')

        a.get_by_role('button', name='Tout effacer').click()
        cleared = compare('tout effacer')
        if cleared != 0:
            failures.append('clear left non-white pixels')
        a.get_by_role('button', name='Annuler').click()
        compare('undo clear')

        b.reload()
        b.locator('canvas.board').wait_for()
        b.wait_for_timeout(800)
        compare('guesser reload replay')
        compare('third player', c)

        browser.close()
    if failures:
        print('FAILURES:', failures)
        sys.exit(1)
    print('ALL OK')


main()
