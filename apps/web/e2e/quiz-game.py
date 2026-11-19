"""Three-player quiz game check (manual, not part of `pnpm test`).

Prerequisites:
  cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # once (git-ignored), sets ADMIN_PASSWORD
  pnpm --filter worker exec wrangler d1 migrations apply kgames --local
  pnpm --filter web build && pnpm --filter worker dev       # port 8787
Usage: python3 apps/web/e2e/quiz-game.py [--base http://localhost:8787] [--shots DIR] [--chrome /usr/bin/google-chrome]

Two questions are imported in their own theme through the admin API (re-runs skip them as
duplicates); Alice (host) plays only that theme. Question 1: answers stay hidden from the others
while answering, an answer can be changed, identical answers form one group, the reveal goes card
by card, nobody sees the correct answer before « Montrer la réponse », votes end in a tie the host
decides. Question 2: Carol gives no answer (❌ without vote), the host ends the vote early. Scores
are checked after each question and on the podium; Rejouer goes back to the lobby. Carol's
1280×800 window must never scroll.
"""
import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8787')
ap.add_argument('--shots', default='/home/claude/out')
ap.add_argument('--chrome', default='/usr/bin/google-chrome')
args = ap.parse_args()

THEME = 'Culture e2e'
QUESTIONS = [
    {'theme': THEME, 'question': "Quelle ville est la capitale fédérale de l'Australie ?", 'answer': 'Canberra', 'variants': ['Canbera']},
    {'theme': THEME, 'question': 'Combien de côtés compte un hexagone ?', 'answer': '6', 'variants': ['six', 'six côtés']},
]
# Text only the correct answer card can contain (the questions come in random order; the
# players' answers below are the same whichever comes first: nothing is validated automatically).
SECRET = {QUESTIONS[0]['question']: 'canbera', QUESTIONS[1]['question']: 'six côtés'}
SETTINGS = {'questionCount': 5, 'answerSeconds': 20, 'maxPlayers': 8, 'themes': [THEME]}
HTML_JS = '() => document.documentElement.outerHTML.toLowerCase()'
NO_SCROLL_JS = '() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth'

failures = []


def check(cond, label):
    print(('OK   ' if cond else 'FAIL ') + label)
    if not cond:
        failures.append(label)


def admin_password():
    dev_vars = pathlib.Path(__file__).resolve().parents[2] / 'worker' / '.dev.vars'
    for line in dev_vars.read_text().splitlines():
        if line.startswith('ADMIN_PASSWORD='):
            return line.split('=', 1)[1].strip()
    raise RuntimeError(f'ADMIN_PASSWORD missing from {dev_vars}')


def seed(p):
    api = p.request.new_context(base_url=args.base)
    r = api.post('/api/admin/login', data={'password': admin_password()})
    if r.status != 204:
        raise RuntimeError(f'admin login failed: {r.status}')
    r = api.post('/api/admin/import', data={'questions': QUESTIONS})
    print('import:', r.status, r.text())
    themes = {t['theme']: t['count'] for t in api.get('/api/themes').json()}
    api.dispose()
    if themes.get(THEME) != 2:
        raise RuntimeError(f'theme {THEME!r} should hold exactly 2 questions, got {themes.get(THEME)}')


def answer(pg, text, last=False):
    inp = pg.locator('#qz-input')
    inp.fill(text)
    inp.press('Enter')
    # The last answer ends the answering phase at once.
    if not last:
        pg.get_by_text('Réponse envoyée ✓').wait_for()


def wait_title(pages, title, timeout=8000):
    for pg in pages:
        pg.locator('.nb-title', has_text=title).wait_for(timeout=timeout)


def cards(pg):
    return pg.locator('.qz-answer')


def card(pg, text):
    return pg.locator('.qz-answer', has=pg.locator('.qz-answer-text', has_text=text))


def scores_of(pg):
    """name -> score text from the left players card."""
    out = {}
    for li in pg.locator('.quiz-grid > .players li').all():
        name = li.locator('.player-name').inner_text().split(' (')[0].replace('♛', '').replace('✓', '').strip()
        out[name] = li.locator('.score').inner_text()
    return out


def main():
    with sync_playwright() as p:
        seed(p)
        browser = p.chromium.launch(executable_path=args.chrome)
        pages = {}
        for name in ('Alice', 'Bob', 'Carol'):
            size = {'width': 1280, 'height': 800} if name == 'Carol' else {'width': 1440, 'height': 900}
            c = browser.new_context(viewport=size)
            extra = f"localStorage.setItem('kg.quizSettings', {json.dumps(json.dumps(SETTINGS))});" if name == 'Alice' else ''
            c.add_init_script(f"localStorage.setItem('kg.name', {name!r});{extra}")
            pg = c.new_page()
            pg.on('pageerror', lambda e, n=name: failures.append(f'{n} page error: {e}'))
            pages[name] = pg
        a, b, c = pages['Alice'], pages['Bob'], pages['Carol']
        everyone = [a, b, c]

        def no_scroll(label):
            check(c.evaluate(NO_SCROLL_JS), f'no page scroll at 1280×800 ({label})')

        # ---- Lobby
        a.goto(args.base + '/')
        a.locator('.game-quiz').get_by_role('button', name='Créer une salle').click()
        a.wait_for_url('**/quiz/*')
        url = a.url
        b.goto(url)
        c.goto(url)
        a.get_by_text('Carol').first.wait_for()
        a.get_by_text('Bob').first.wait_for()
        a.locator('.chip[aria-pressed="true"]', has_text=THEME).wait_for()
        check(a.locator('.available').inner_text() == '2 questions disponibles : la partie en comptera 2.', 'lobby shows the available question count')
        check(c.locator('.chip[aria-pressed="true"]', has_text=THEME).count() == 1 and c.locator('.chip').first.is_disabled(), 'others see the chosen theme, read-only')
        a.wait_for_timeout(400)
        a.screenshot(path=f'{args.shots}/quiz-lobby.png')
        no_scroll('lobby')
        a.get_by_role('button', name='Lancer la partie').click()

        # ---- Question 1: answering
        wait_title(everyone, 'Réponds !')
        check(a.locator('.qz-notebook').get_attribute('aria-label') == 'Question 1/2', 'header says question 1/2')
        check(a.locator('.nb-theme').text_content() == THEME, 'header shows the theme')
        check(a.locator('.timer').count() == 1, 'timer badge shown while answering')
        question1 = a.locator('.qz-question').inner_text()
        check(question1 in SECRET, 'question shown in big type')
        q1 = next(q for q in QUESTIONS if q['question'] == question1)
        q2 = next(q for q in QUESTIONS if q is not q1)
        secret1 = SECRET[q1['question']]

        answer(c, 'Melbourne')
        check(c.locator('.qz-sent-text').inner_text() == 'Melbourne', 'Carol sees her sent answer')
        b.locator('.players li', has_text='Carol').locator('.mark.ok').wait_for()
        check(True, 'others see a check next to Carol')
        for pg, who in ((a, 'Alice'), (b, 'Bob')):
            check('melbourne' not in pg.evaluate(HTML_JS), f'{who} DOM has no trace of Carol\'s answer')
        c.get_by_role('button', name='Modifier').click()
        check(c.locator('#qz-input').input_value() == 'Melbourne', 'Modifier pre-fills the answer')
        answer(c, 'Sydney')
        check(c.locator('.qz-sent-text').inner_text() == 'Sydney', 'changed answer is shown')

        answer(a, 'Canberra')
        for pg, who in ((b, 'Bob'), (c, 'Carol')):
            html = pg.evaluate(HTML_JS)
            check('canberra' not in html and secret1 not in html, f'{who} DOM has no Canberra nor the correct answer while answering')
        check('sydney' not in b.evaluate(HTML_JS), 'Bob DOM has no Sydney while answering')
        b.locator('.players li', has_text='Alice').locator('.mark.ok').wait_for()
        b.screenshot(path=f'{args.shots}/quiz-answering.png')
        a.screenshot(path=f'{args.shots}/quiz-answered.png')
        no_scroll('answering')
        answer(b, '  CANBERRA ', last=True)

        # ---- Question 1: reveal
        wait_title(everyone, 'Les réponses')
        check(a.locator('.timer').count() == 0, 'no timer once answering is over')
        check(b.get_by_text('Alice fait défiler les réponses…').count() == 1 and b.locator('.qz-foot .btn').count() == 0, 'others see « Alice fait défiler les réponses… » and no button')
        check(all(cards(pg).count() == 0 for pg in everyone), 'no answer shown before the first click')
        check('canberra' not in c.evaluate(HTML_JS), 'Carol still has no Canberra before the reveal')
        check(a.locator('.qz-foot .btn').inner_text() == 'Suivant', 'host button « Suivant »')
        a.get_by_role('button', name='Suivant').click()
        for pg in everyone:
            cards(pg).first.wait_for()
        check(all(cards(pg).count() == 1 for pg in everyone), 'one card after one click')
        first = c.locator('.qz-answer').first
        check(first.locator('.qz-answer-text').inner_text() == 'Canberra' and first.locator('.qz-authors').inner_text() == 'Alice, Bob', 'identical answers grouped with both authors')
        a.get_by_role('button', name='Suivant').click()
        for pg in everyone:
            card(pg, 'Sydney').wait_for()
        check(all(cards(pg).count() == 2 for pg in everyone), 'second card after the second click')
        check(a.locator('.qz-foot .btn').inner_text() == 'Montrer la réponse', 'host button becomes « Montrer la réponse »')
        a.wait_for_timeout(300)
        for pg, who in zip(everyone, ('Alice', 'Bob', 'Carol')):
            html = pg.evaluate(HTML_JS)
            check('bonne réponse' not in html and secret1 not in html, f'{who} has no correct answer before « Montrer la réponse »')
        a.get_by_role('button', name='Montrer la réponse').click()
        for pg in everyone:
            pg.locator('.qz-correct').wait_for()
        check(c.locator('.qz-correct-main').inner_text() == f"Bonne réponse : {q1['answer']}", 'everyone sees « Bonne réponse : … »')
        check(c.locator('.qz-variants').inner_text() == 'Aussi accepté : ' + ', '.join(q1['variants']), 'variants listed small')
        b.wait_for_timeout(500)
        b.screenshot(path=f'{args.shots}/quiz-reveal.png')
        no_scroll('reveal')
        check(a.locator('.qz-foot .btn').inner_text() == 'Passer au vote', 'host button becomes « Passer au vote »')
        a.get_by_role('button', name='Passer au vote').click()

        # ---- Question 1: votes, then a tie decided by the host
        wait_title(everyone, 'Le vote')
        check(c.locator('.qz-pinned .qz-correct').count() == 1, 'correct answer pinned at the top of the vote')
        mine = b.locator('.qz-answer.mine')
        check(mine.count() == 1 and 'Ta réponse' in mine.inner_text() and mine.locator('.vote-btn').count() == 0, 'own group shows « Ta réponse » without buttons')
        check(a.get_by_role('button', name='Terminer le vote').count() == 1 and b.get_by_role('button', name='Terminer le vote').count() == 0, 'only the host has « Terminer le vote »')
        check(a.locator('.qz-status').inner_text() == 'En attente de : Alice, Bob, Carol', 'pending voters listed')
        card(c, 'Canberra').get_by_role('button', name='Correct').click()
        a.locator('.qz-status', has_text='En attente de : Alice, Bob').wait_for()
        check('Carol' not in a.locator('.qz-status').inner_text(), 'Carol leaves the pending list after voting')
        check(card(c, 'Canberra').get_by_role('button', name='Correct').get_attribute('aria-pressed') == 'true', 'chosen vote highlighted')
        card(b, 'Sydney').get_by_role('button', name='Correct').click()
        a.locator('.qz-status', has_text='En attente de : Alice').wait_for()
        b.screenshot(path=f'{args.shots}/quiz-voting.png')
        no_scroll('voting')
        card(a, 'Sydney').get_by_role('button', name='Faux').click()

        wait_title(everyone, 'Égalité')
        check(a.get_by_text('Égalité — à toi de trancher').count() == 1, 'host sees « Égalité — à toi de trancher »')
        check(b.get_by_text('Alice tranche les égalités…').count() == 1, 'others see « Alice tranche les égalités… »')
        check(cards(a).count() == 1 and card(a, 'Sydney').count() == 1, 'only the tied group is shown')
        check(card(a, 'Sydney').locator('.vote-btn').count() == 3 and card(b, 'Sydney').locator('.vote-btn').count() == 0, 'only the host can decide')
        a.screenshot(path=f'{args.shots}/quiz-deciding.png')
        no_scroll('deciding')
        card(a, 'Sydney').get_by_role('button', name='À moitié').click()

        # ---- Question 1: result
        wait_title(everyone, 'Résultats')
        check(card(c, 'Canberra').locator('.qz-points').inner_text() == '+1' and 'Correct' in card(c, 'Canberra').locator('.qz-outcome').inner_text(), 'Canberra: Correct, +1')
        check(card(c, 'Sydney').locator('.qz-points').inner_text() == '+0,5' and 'À moitié' in card(c, 'Sydney').locator('.qz-outcome').inner_text(), 'Sydney: À moitié, +0,5')
        check(scores_of(c) == {'Alice': '1', 'Bob': '1', 'Carol': '0,5'}, f'scores after question 1: {scores_of(c)}')
        check(b.get_by_text('En attente de Alice…').count() == 1, 'others wait for the host')
        a.screenshot(path=f'{args.shots}/quiz-result.png')
        no_scroll('result')
        a.get_by_role('button', name='Question suivante').click()

        # ---- Question 2: Carol stays silent, the host ends the vote early
        wait_title(everyone, 'Réponds !')
        check(a.locator('.qz-notebook').get_attribute('aria-label') == 'Question 2/2', 'header says question 2/2')
        check(c.locator('#qz-input').input_value() == '', 'answer box empty on a new question')
        check(a.locator('.qz-question').inner_text() == q2['question'], 'second question shown')
        answer(a, '6')
        answer(b, 'six', last=False)
        wait_title(everyone, 'Les réponses', timeout=30000)
        for _ in range(3):
            a.locator('.qz-foot .btn').click()
            a.wait_for_timeout(250)
        check(cards(a).count() == 2 and a.locator('.qz-correct').count() == 1, 'two groups (no blank one) and the answer')
        check(c.locator('.qz-variants').inner_text() == 'Aussi accepté : ' + ', '.join(q2['variants']), 'variants listed small (question 2)')
        a.get_by_role('button', name='Passer au vote').click()
        wait_title(everyone, 'Le vote')
        check(cards(c).count() == 2 and c.locator('.qz-answer.mine').count() == 0, 'Carol, who did not answer, votes on both groups')
        card(c, '6').get_by_role('button', name='Correct').click()
        card(c, 'six').get_by_role('button', name='Correct').click()
        card(b, '6').get_by_role('button', name='Correct').click()
        a.locator('.qz-status', has_text='En attente de : Alice').wait_for()
        a.get_by_role('button', name='Terminer le vote').click()
        wait_title(everyone, 'Résultats')
        check(card(a, 'six').locator('.qz-points').inner_text() == '+1', 'six: +1 with Carol\'s vote only')
        check(a.locator('.qz-ranking li', has_text='Carol').locator('.qz-gained').inner_text() == '+0', 'no answer: +0')
        check(scores_of(a) == {'Alice': '2', 'Bob': '2', 'Carol': '0,5'}, f'scores after question 2: {scores_of(a)}')
        check(a.locator('.qz-foot .btn').inner_text() == 'Voir le classement', 'last question: « Voir le classement »')
        a.get_by_role('button', name='Voir le classement').click()

        # ---- Game over
        for pg in everyone:
            pg.get_by_text('Partie terminée !').wait_for()
        check(a.locator('.pod').count() == 3 and a.locator('.final-list li').count() == 3, 'podium + full list')
        check(a.locator('.final-list .score').all_inner_texts() == ['2', '2', '0,5'], 'final scores 2, 2, 0,5')
        check(a.get_by_role('button', name='Rejouer').count() == 1 and b.get_by_role('button', name='Rejouer').count() == 0, 'only the host sees Rejouer')
        check(b.get_by_role('link', name='Accueil').get_attribute('href') == '/', 'Accueil links to /')
        a.screenshot(path=f'{args.shots}/quiz-gameover.png')
        no_scroll('game over')
        a.get_by_role('button', name='Rejouer').click()
        a.get_by_role('button', name='Lancer la partie').wait_for()
        b.get_by_text("En attente du lancement par l'hôte…").wait_for()
        check(a.locator('.chip[aria-pressed="true"]', has_text=THEME).count() == 1, 'Rejouer returns to the lobby with the settings kept')
        browser.close()
    if failures:
        print('FAILURES:', failures)
        sys.exit(1)
    print('ALL OK')


main()
