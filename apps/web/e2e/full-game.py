"""Three-player full-game check (manual, not part of `pnpm test`).

Prerequisites: `pnpm --filter web build` then `pnpm --filter worker dev` (port 8787).
Usage: python3 apps/web/e2e/full-game.py [--base http://localhost:8787] [--shots DIR] [--chrome /usr/bin/google-chrome]

Alice (host) sets 1 round, drawSeconds 30, hintUnlockPct 0, maxHints 2. In the first turn:
a close guess is only acknowledged to its author, a wrong guess shows in everyone's chat,
the drawer reveals letters up to maxHints (a further click does nothing), a correct guess
is announced without the word, and nobody but the drawer and the finder has the word in
their DOM. The two other turns are finished quickly, then game over, Rejouer -> lobby.
"""
import argparse
import sys

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8787')
ap.add_argument('--shots', default='/home/claude/kgames/.superpowers/sdd/2026-11-19-socle-pictionary')
ap.add_argument('--chrome', default='/usr/bin/google-chrome')
args = ap.parse_args()

failures = []


def check(cond, label):
    print(('OK   ' if cond else 'FAIL ') + label)
    if not cond:
        failures.append(label)


def init_script(name, extra=''):
    return f"localStorage.setItem('kg.name', {name!r});{extra}"


SETTINGS = "localStorage.setItem('kg.pictionarySettings', JSON.stringify({rounds: 1, drawSeconds: 30, chooseSeconds: 15, maxHints: 2, hintUnlockPct: 0}));"
HTML_JS = "() => document.documentElement.outerHTML.toLowerCase()"


def wait_drawer(pages):
    """The page showing the word-choice buttons."""
    for _ in range(100):
        for pg in pages:
            if pg.locator('.choices button').count():
                return pg
        pages[0].wait_for_timeout(200)
    raise RuntimeError('no drawer found')


def pick_longest(drawer):
    btns = drawer.locator('.choices button')
    texts = btns.all_inner_texts()
    i = max(range(len(texts)), key=lambda k: len(texts[k]))
    btns.nth(i).click()
    drawer.locator('.slots[aria-label^="Le mot"]').wait_for()
    label = drawer.locator('.slots').get_attribute('aria-label')
    return label.removeprefix('Le mot : ')


def guess(pg, text):
    inp = pg.locator('.chat-input')
    inp.fill(text)
    inp.press('Enter')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome)
        ctxs, pages = {}, {}
        for name in ('Alice', 'Bob', 'Carol'):
            c = browser.new_context(viewport={'width': 1280, 'height': 900})
            c.add_init_script(init_script(name, SETTINGS if name == 'Alice' else ''))
            pg = c.new_page()
            pg.on('pageerror', lambda e, n=name: failures.append(f'{n} page error: {e}'))
            ctxs[name], pages[name] = c, pg
        a = pages['Alice']
        everyone = list(pages.values())

        a.goto(args.base + '/')
        a.get_by_role('button', name='Créer une salle').click()
        a.wait_for_url('**/pictionary/*')
        url = a.url
        for n in ('Bob', 'Carol'):
            pages[n].goto(url)
        a.get_by_text('Carol').first.wait_for()
        a.get_by_text('Bob').first.wait_for()
        a.wait_for_timeout(600)
        a.get_by_role('button', name='Lancer la partie').click()

        # ---- Turn 1: full checks
        drawer = wait_drawer(everyone)
        guessers = [pg for pg in everyone if pg is not drawer]
        g1, g2 = guessers
        for pg in guessers:
            pg.locator('.overlay').wait_for()
            check('choisit un mot' in pg.locator('.overlay').inner_text(), 'guesser sees "{nom} choisit un mot…" while choosing')
            check(pg.locator('.chat-input').is_disabled() and pg.locator('.chat-input').get_attribute('placeholder') == 'Attends le prochain dessin…', 'guesser input disabled while choosing')
        word = pick_longest(drawer)
        print('word:', word)
        for pg in everyone:
            pg.locator('.overlay').wait_for(state='detached')
        check(drawer.locator('.chat-input').is_disabled(), 'drawer chat input disabled')
        check(drawer.locator('.toolbar').count() == 1 and g1.locator('.toolbar').count() == 0, 'toolbar for drawer only')
        check('Indices restants : 2' in drawer.locator('.wordbar').inner_text(), 'drawer sees "Indices restants : 2"')
        check(g1.locator('.slot:not(.sep)').count() == len([c for c in word if c not in " -'’"]), 'guesser sees one slot per letter')
        check(word.lower() not in g1.evaluate(HTML_JS), 'guesser DOM has no word while drawing')

        # drawer draws a bit
        box = drawer.locator('canvas.board').bounding_box()
        drawer.mouse.move(box['x'] + 100, box['y'] + 100)
        drawer.mouse.down()
        drawer.mouse.move(box['x'] + 300, box['y'] + 250, steps=10)
        drawer.mouse.up()

        # hints: reveal up to maxHints, then nothing
        letters = drawer.locator('.letter-btn')
        letters.first.click()
        drawer.wait_for_timeout(300)
        drawer.locator('.letter-btn:not([disabled])').first.click()
        drawer.wait_for_timeout(400)
        check(drawer.locator('.slot.revealed').count() == 2, 'drawer revealed 2 letters')
        check('Indices restants : 0' in drawer.locator('.wordbar').inner_text(), 'hints left 0')
        check(drawer.locator('.letter-btn:not([disabled])').count() == 0, 'no letter clickable after maxHints')
        letters.nth(letters.count() - 1).click(force=True)
        drawer.wait_for_timeout(400)
        check(drawer.locator('.slot.revealed').count() == 2, 'extra click revealed nothing')
        check(g1.locator('.slot.revealed').count() == 2, 'guesser sees the 2 revealed slots')
        check(word.lower() not in g1.evaluate(HTML_JS), 'guesser DOM has no word after hints')

        # wrong guess: visible to all
        guess(g2, 'zzzzzzzz')
        drawer.get_by_text('zzzzzzzz').wait_for()
        check(g1.locator('.chat-list').inner_text().count('zzzzzzzz') == 1, 'wrong guess shown in others\' chat')
        check(g2.locator('.chat-input').input_value() == '' and g2.evaluate('document.activeElement.className') == 'chat-input', 'input cleared and focus kept after send')

        # close guess: only its author
        guess(g1, word + 'x')
        g1.locator('.chat-close').wait_for()
        check(g1.locator('.chat-close').inner_text() == 'tu chauffes !', 'author sees « tu chauffes ! »')
        g1.locator('.chat-close').wait_for(state='detached', timeout=4000)
        check(True, '« tu chauffes ! » disappears')
        g2.wait_for_timeout(300)
        for pg, who in ((g2, 'other guesser'), (drawer, 'drawer')):
            html = pg.evaluate(HTML_JS)
            check('tu chauffes' not in html and (word + 'x').lower() not in html, f'{who} has no trace of the close guess')

        drawer.screenshot(path=f'{args.shots}/task-11-drawer.png', full_page=True)

        # correct guess
        guess(g1, word.upper())
        g2.get_by_text('a trouvé !').wait_for()
        names = {id(a): 'Alice', id(pages['Bob']): 'Bob', id(pages['Carol']): 'Carol'}
        name1 = names[id(g1)]
        check(f'« {name1} a trouvé ! »' in g2.locator('.chat-list').inner_text(), 'others see « X a trouvé ! »')
        check(word.lower() not in g2.evaluate(HTML_JS), 'non-finder DOM has no word after a find')
        g1.locator('.wordbar .slots').wait_for()
        check(word.lower() in g1.evaluate(HTML_JS), 'finder sees the word')
        check(g1.locator('.chat-input').is_disabled() and g1.locator('.chat-input').get_attribute('placeholder') == 'Tu as trouvé !', 'finder input disabled « Tu as trouvé ! »')
        g2.screenshot(path=f'{args.shots}/task-11-guesser.png', full_page=True)

        guess(g2, word)
        for pg in everyone:
            pg.get_by_text(f'Le mot était : {word}').first.wait_for(timeout=5000)
        ov = g2.locator('.overlay').inner_text()
        check('+' in ov and word in ov, 'turn-end overlay shows word and points')
        g2.screenshot(path=f'{args.shots}/task-11-turnend.png', full_page=True)

        # ---- Turns 2 and 3
        for t in (2, 3):
            for pg in everyone:
                pg.locator('.overlay .choices, .overlay h2').first.wait_for(timeout=9000)
            d = wait_drawer(everyone)
            w = pick_longest(d)
            gs = [pg for pg in everyone if pg is not d]
            for pg in gs:
                pg.locator('.overlay').wait_for(state='detached')
                guess(pg, w)
            print(f'turn {t} done, word {w}')

        # ---- Game over
        for pg in everyone:
            pg.get_by_text('Partie terminée !').wait_for(timeout=15000)
        check(a.get_by_role('button', name='Rejouer').count() == 1, 'host sees Rejouer')
        for n in ('Bob', 'Carol'):
            check(pages[n].get_by_role('button', name='Rejouer').count() == 0 and pages[n].get_by_text("En attente de l'hôte…").count() == 1, f'{n} sees « En attente de l\'hôte… » only')
        check(a.locator('.pod').count() == 3 and a.locator('.final-list li').count() == 3, 'podium + full list')
        check(a.get_by_role('link', name='Accueil').get_attribute('href') == '/', 'Accueil links to /')
        a.screenshot(path=f'{args.shots}/task-11-gameover.png', full_page=True)

        a.get_by_role('button', name='Rejouer').click()
        for pg in everyone:
            pg.locator('.game-grid, .gameover').first.wait_for(state='detached', timeout=5000)
        a.get_by_role('button', name='Lancer la partie').wait_for()
        check(True, 'Rejouer returns everyone to the lobby')
        browser.close()
    if failures:
        print('FAILURES:', failures)
        sys.exit(1)
    print('ALL OK')


main()
