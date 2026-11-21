"""Three-player Pictionary imposter-mode check (manual, not part of `pnpm test`).

Prerequisites: `pnpm --filter web build` then `pnpm --filter worker dev` (port 8787).
Usage: python3 apps/web/e2e/imposter.py [--base http://localhost:8787] [--shots /home/claude/out] [--chrome /usr/bin/google-chrome]

Alice (host) switches the lobby to « Imposteur » (1 manche, 1 tour de table, 10 s per stroke),
« 3 joueurs minimum » until Carol joins. Each page's role card says (data-imposter) who the
imposter is; the imposter's DOM and received frames never hold the word before the result.
Each drawer gets one stroke in their colour, seen by everyone; a non-current player cannot draw.
The host skips the discussion, everyone votes, the unmasked imposter guesses wrong, result,
game over. Layout: no page scroll at 1280×800.
"""
import argparse
import json
import re
import sys

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8787')
ap.add_argument('--shots', default='/home/claude/out')
ap.add_argument('--chrome', default='/usr/bin/google-chrome')
args = ap.parse_args()

failures = []
NAMES = ('Alice', 'Bob', 'Carol')
VIEW = {'width': 1440, 'height': 900}
SETTINGS = ("localStorage.setItem('kg.pictionarySettings', JSON.stringify("
            "{mode: 'classique', impRounds: 1, impTableRounds: 1, impStrokeSeconds: 10, impDiscussSeconds: 60}));")
# Every text node and attribute value (class names and styles aside), to look for the word as a whole word.
STRINGS_JS = """() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walk.currentNode; n; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) out.push(n.nodeValue);
    else for (const at of n.attributes) if (at.name !== 'class' && at.name !== 'style') out.push(at.value);
  }
  out.push(document.title);
  return out.map((t) => t.toLowerCase());
}"""
NO_SCROLL_JS = "() => document.scrollingElement.scrollHeight <= innerHeight && document.scrollingElement.scrollWidth <= innerWidth"
NONWHITE_JS = """() => {
  const c = document.querySelector('canvas.board');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) n++;
  return n;
}"""
PIXEL_JS = """([x, y]) => Array.from(document.querySelector('canvas.board').getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3))"""
DOT_COLOR_JS = """() => getComputedStyle(document.querySelector('.turn-bar li.current .imp-dot')).backgroundColor"""


def check(cond, label):
    print(('OK   ' if cond else 'FAIL ') + label)
    if not cond:
        failures.append(label)


def init_script(name, extra=''):
    return f"localStorage.setItem('kg.name', {name!r});{extra}"


def has_word(pg, word):
    pat = re.compile(r'(^|\W)' + re.escape(word) + r'($|\W)')
    return any(pat.search(t) for t in pg.evaluate(STRINGS_JS))


def frame_has_word(frame, word):
    """The word as a JSON string value anywhere in the frame (not a key such as "chat")."""
    return re.search(re.escape(json.dumps(word, ensure_ascii=False)) + r'(?!\s*:)', frame.lower()) is not None


def rgb(css):
    return [int(v) for v in css[css.index('(') + 1:css.index(')')].split(',')[:3]]


def drag(pg, y, x0=150, x1=650):
    """A horizontal stroke at logical height y (800×600 board)."""
    box = pg.locator('canvas.board').bounding_box()
    at = lambda x: (box['x'] + x / 800 * box['width'], box['y'] + y / 600 * box['height'])
    pg.mouse.move(*at(x0))
    pg.mouse.down()
    pg.mouse.move(*at(x1), steps=20)
    pg.mouse.up()


def no_scroll(pg, label):
    pg.set_viewport_size({'width': 1280, 'height': 800})
    pg.wait_for_timeout(250)
    check(pg.evaluate(NO_SCROLL_JS), f'no page scroll at 1280×800: {label}')
    pg.set_viewport_size(VIEW)
    pg.wait_for_timeout(150)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome)
        pages, frames = {}, {}
        for name in NAMES:
            c = browser.new_context(viewport=VIEW)
            c.add_init_script(init_script(name, SETTINGS if name == 'Alice' else ''))
            pg = c.new_page()
            pg.on('pageerror', lambda e, n=name: failures.append(f'{n} page error: {e}'))
            frames[name] = []
            pg.on('websocket', lambda ws, n=name: ws.on('framereceived', lambda f, n=n: frames[n].append(f if isinstance(f, str) else f.decode())))
            pages[name] = pg
        a, b, c = pages['Alice'], pages['Bob'], pages['Carol']
        everyone = list(pages.values())

        # ---- Lobby
        a.goto(args.base + '/')
        a.locator('.game-pictionary').get_by_role('button', name='Créer une salle').click()
        a.wait_for_url('**/pictionary/*')
        url = a.url
        b.goto(url)
        a.get_by_text('Bob').first.wait_for()
        a.get_by_role('radio', name='Imposteur').click()
        a.get_by_text('Secondes par trait').wait_for()
        b.get_by_text('Secondes par trait').wait_for()
        check(b.get_by_role('radio', name='Imposteur').get_attribute('aria-checked') == 'true', 'guest sees the Imposteur mode')
        check(a.get_by_text('Mots personnalisés').count() == 0, 'imposter settings replace the Classique ones')
        check(a.get_by_role('button', name='Lancer la partie').is_disabled(), 'start disabled with 2 players')
        check(a.locator('.lobby-foot').get_by_text('3 joueurs minimum').count() == 1, '« 3 joueurs minimum » hint')
        a.screenshot(path=f'{args.shots}/imp-lobby.png')
        c.goto(url)
        a.get_by_text('Carol').first.wait_for()
        a.wait_for_timeout(500)
        a.get_by_role('button', name='Lancer la partie').click()

        # ---- Role reveal
        roles = {}
        for n, pg in pages.items():
            pg.locator('.role-card').wait_for(timeout=8000)
            roles[n] = pg.locator('.role-card').get_attribute('data-imposter') == 'true'
        imposters = [n for n, v in roles.items() if v]
        check(len(imposters) == 1, f'exactly one imposter ({imposters})')
        imp_name = imposters[0]
        imp = pages[imp_name]
        others = [n for n in NAMES if n != imp_name]
        word = pages[others[0]].locator('.role-word strong').inner_text().strip().lower()
        category = imp.locator('.role-cat strong').inner_text()
        print('imposter:', imp_name, '| category:', category, '| word:', word)
        check(pages[others[1]].locator('.role-word strong').inner_text().strip().lower() == word, 'both non-imposters have the same word')
        check("Tu es l'imposteur 🤫" in imp.locator('.role-card').text_content(), 'imposter sees « Tu es l\'imposteur 🤫 »')
        check(all(pages[n].locator('.role-cat strong').inner_text() == category for n in others), 'everyone sees the same category')
        check(not has_word(imp, word), 'imposter DOM has no word at reveal')
        check(has_word(pages[others[0]], word), 'non-imposter DOM has the word (check sanity)')
        imp.screenshot(path=f'{args.shots}/imp-role-imposter.png')
        pages[others[0]].screenshot(path=f'{args.shots}/imp-role-word.png')

        # ---- Drawing turns
        for turn in range(3):
            drawer = None
            for _ in range(100):
                drawer = next((n for n, pg in pages.items() if pg.locator('.stroke-bar').count()), None)
                if drawer:
                    break
                a.wait_for_timeout(100)
            check(drawer is not None, f'turn {turn + 1}: someone draws')
            d = pages[drawer]
            watchers = [n for n in NAMES if n != drawer]
            check(all(pages[n].locator('.stroke-bar').count() == 0 and pages[n].locator('.toolbar').count() == 0 for n in watchers), f'turn {turn + 1}: no controls for the others')
            check(d.locator('.toolbar').count() == 0, f'turn {turn + 1}: drawer has no toolbar')
            check(d.locator('.secret-word').inner_text().lower() == ('???' if drawer == imp_name else word), f'turn {turn + 1}: header shows the word or ???')
            check(imp.locator('.secret-word').inner_text() == '???', f'turn {turn + 1}: imposter header shows ???')
            color = rgb(d.evaluate(DOT_COLOR_JS))
            for n in watchers:
                check(rgb(pages[n].evaluate(DOT_COLOR_JS)) == color, f'turn {turn + 1}: {n} highlights the same drawer')

            # a watcher tries to draw: nothing changes anywhere
            before = {n: pg.evaluate(NONWHITE_JS) for n, pg in pages.items()}
            drag(pages[watchers[0]], 80 + turn * 30)
            a.wait_for_timeout(400)
            check(all(pg.evaluate(NONWHITE_JS) == before[n] for n, pg in pages.items()), f'turn {turn + 1}: non-current player cannot draw')

            if turn == 1:
                d.screenshot(path=f'{args.shots}/imp-drawing.png')
                pages[watchers[0]].screenshot(path=f'{args.shots}/imp-watching.png')
                no_scroll(d, 'drawer')
                no_scroll(pages[watchers[0]], 'watcher')

            y = 200 + turn * 120
            drag(d, y)
            # pointerup ends the turn
            d.locator('.stroke-bar').wait_for(state='detached', timeout=4000)
            check(True, f'turn {turn + 1}: lifting the pen ends the turn')
            a.wait_for_timeout(400)
            for n, pg in pages.items():
                hits = sum(pg.evaluate(PIXEL_JS, [x, y]) == color for x in (250, 350, 450, 550, 600))
                check(hits >= 3, f'turn {turn + 1}: {n} sees {drawer}\'s stroke in their colour {color} ({hits}/5)')
            check(not has_word(imp, word), f'turn {turn + 1}: imposter DOM has no word')

        # ---- Discussion → vote
        a.get_by_role('button', name='Passer au vote').wait_for(timeout=8000)
        check(b.get_by_role('button', name='Passer au vote').count() == 0, 'only the host can skip the discussion')
        a.get_by_role('button', name='Passer au vote').click()
        for pg in everyone:
            pg.locator('.vote-list').wait_for(timeout=5000)
        voter = pages[others[0]]
        check(voter.locator('.vote-player').count() == 2, 'one vote button per other player')
        check('En attente :' in voter.locator('.imp-phase').inner_text(), '« En attente : … » shown')
        voter.locator('.vote-player', has_text=imp_name).click()
        voter.locator('.vote-player[aria-pressed="true"]').wait_for()
        voter.wait_for_timeout(300)
        check(others[0] not in voter.locator('.vote-waiting').inner_text(), 'voter leaves the waiting list')
        voter.screenshot(path=f'{args.shots}/imp-vote.png')
        no_scroll(voter, 'vote')
        check(not has_word(imp, word), 'imposter DOM has no word during the vote')
        pages[others[1]].locator('.vote-player', has_text=imp_name).click()
        imp.locator('.vote-player', has_text=others[0]).click()

        # ---- Guess
        imp.get_by_label('Quel était le mot ?').wait_for(timeout=5000)
        for n in others:
            pages[n].get_by_text(f'{imp_name} est démasqué ! Il tente de deviner le mot…').wait_for()
        check(pages[others[0]].locator('.nb-title').inner_text().lower() == f'{imp_name} tente sa chance…'.lower(), 'others see « {nom} tente sa chance… »')
        check(not has_word(imp, word), 'imposter DOM has no word during the guess')
        imp.screenshot(path=f'{args.shots}/imp-guess.png')
        sent_before_result = len(frames[imp_name])
        leaked = [f for f in frames[imp_name][:sent_before_result] if frame_has_word(f, word)]
        check(not leaked, f'no frame received by the imposter before the result holds the word ({len(leaked)})')
        imp.get_by_label('Quel était le mot ?').fill('zzzzzz')
        imp.get_by_role('button', name='Valider').click()

        # ---- Result
        for pg in everyone:
            pg.locator('.imp-result').wait_for(timeout=5000)
        res = imp.locator('.imp-result').text_content()
        check(f"{imp_name} était l'imposteur !" in res, 'result names the imposter')
        check(has_word(imp, word), 'result reveals the word (to the imposter too)')
        check('zzzzzz' in res, 'result shows the guess')
        check("L'imposteur a perdu !" in res, 'imposter lost')
        check(all(f'+1' in pages[n].locator('.imp-result').inner_text() for n in others), 'points shown')
        pages[others[1]].screenshot(path=f'{args.shots}/imp-result.png')
        no_scroll(pages[others[1]], 'result')

        # ---- Game over
        for pg in everyone:
            pg.get_by_text('Partie terminée !').wait_for(timeout=12000)
        scores = {n: a.locator('.final-list li', has_text=n).inner_text() for n in NAMES} if a.locator('.final-list li').count() else {}
        print('final:', json.dumps(scores, ensure_ascii=False))
        a.get_by_role('button', name='Rejouer').click()
        a.get_by_role('button', name='Lancer la partie').wait_for()
        check(a.get_by_role('radio', name='Imposteur').get_attribute('aria-checked') == 'true', 'Rejouer keeps the Imposteur mode')
        browser.close()
    if failures:
        print('FAILURES:', failures)
        sys.exit(1)
    print('ALL OK')


main()
