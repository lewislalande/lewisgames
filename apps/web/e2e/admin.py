"""Admin page check (manual, not part of `pnpm test`).

Prerequisites:
  cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # once (git-ignored), sets ADMIN_PASSWORD
  pnpm --filter worker exec wrangler d1 migrations apply kgames --local
  pnpm --filter web build && pnpm --filter worker dev       # port 8787
Usage: python3 apps/web/e2e/admin.py [--base http://localhost:8787] [--shots DIR] [--chrome /usr/bin/google-chrome]

Wrong then right password; add, edit and delete a question (in-page confirmation); debounced
search and theme filter; import of a 2-question file plus one duplicate (preview, per-theme counts,
report); export download; words save (the original list is restored at the end). The test theme's
questions are removed before and after. Screenshots 1440x900 go to <shots>/admin-*.png.
"""
import argparse
import json
import pathlib
import tempfile

from playwright.sync_api import expect, sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8787')
ap.add_argument('--shots', default='/home/claude/out')
ap.add_argument('--chrome', default='/usr/bin/google-chrome')
args = ap.parse_args()

THEME = 'Admin e2e'
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


PASSWORD = admin_password()
shots = pathlib.Path(args.shots)
shots.mkdir(parents=True, exist_ok=True)


def shot(pg, name):
    pg.screenshot(path=str(shots / f'admin-{name}.png'))


def purge(api):
    """Deletes every question of the test theme (re-runs, and leaves the bank clean)."""
    items = api.get(f'/api/admin/questions?theme={THEME}').json()['items']
    for it in items:
        api.delete(f'/api/admin/questions/{it["id"]}', headers={'content-type': 'application/json'})


with sync_playwright() as p:
    api = p.request.new_context(base_url=args.base)
    assert api.post('/api/admin/login', data={'password': PASSWORD}).status == 204
    purge(api)
    original_words = api.get('/api/admin/words').json()['words']

    browser = p.chromium.launch(executable_path=args.chrome, headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # --- login -------------------------------------------------------------------------------
    pg.goto(args.base + '/admin')
    pg.get_by_label('Mot de passe').wait_for()
    shot(pg, '1-login')
    pg.get_by_label('Mot de passe').fill('pas-le-bon')
    pg.get_by_role('button', name='Se connecter').click()
    pg.get_by_text('Mot de passe incorrect').wait_for()
    check(True, 'wrong password shows « Mot de passe incorrect »')
    shot(pg, '2-login-error')
    pg.get_by_label('Mot de passe').fill(PASSWORD)
    pg.get_by_role('button', name='Se connecter').click()
    pg.get_by_role('button', name='+ Ajouter une question').wait_for()
    check(True, 'right password opens the dashboard')
    pg.reload()
    pg.get_by_role('button', name='+ Ajouter une question').wait_for()
    check(True, 'session survives a reload')

    # --- add ---------------------------------------------------------------------------------
    pg.get_by_role('button', name='+ Ajouter une question').click()
    pg.get_by_label('Thème', exact=True).last.fill(THEME)
    pg.get_by_label('Question', exact=True).fill('Quelle est la plus haute montagne de France ?')
    pg.get_by_label('Réponse', exact=True).fill('Mont Blanc')
    pg.get_by_label('Variantes acceptées (une par ligne)').fill('Le Mont Blanc\nMont-Blanc')
    shot(pg, '3-add-form')
    pg.get_by_role('button', name='Enregistrer').click()
    # The seeded bank fills the first page: look at the test theme only.
    pg.get_by_label('Thème', exact=True).first.select_option(label=f'{THEME} (1)')
    row = pg.locator('tr', has_text='plus haute montagne')
    row.wait_for()
    check('Le Mont Blanc, Mont-Blanc' in row.inner_text(), 'added question listed with variants')
    check('manuel' in row.inner_text(), 'source is « manuel »')

    # duplicate refused
    pg.get_by_role('button', name='+ Ajouter une question').click()
    pg.get_by_label('Thème', exact=True).last.fill(THEME)
    pg.get_by_label('Question', exact=True).fill('QUELLE est la plus  haute montagne de France ?')
    pg.get_by_label('Réponse', exact=True).fill('Autre')
    pg.get_by_role('button', name='Enregistrer').click()
    pg.get_by_text('Cette question existe déjà.').wait_for()
    check(True, 'duplicate question refused')
    pg.get_by_role('button', name='Annuler').click()

    # --- search / theme filter -----------------------------------------------------------------
    calls = []
    pg.on('request', lambda r: calls.append(r.url))
    pg.get_by_label('Rechercher').press_sequentially('montagne', delay=40)
    pg.wait_for_timeout(1000)  # sync Playwright only delivers events while it waits
    calls[:] = [c for c in calls if '/api/admin/questions?' in c]
    check(len([c for c in calls if 'q=' in c]) == 1, f'search is debounced (one request for 8 keystrokes, got {len([c for c in calls if "q=" in c])})')
    check(pg.locator('tbody tr').count() >= 1 and all('montagne' in t.lower() for t in pg.locator('tbody tr').all_inner_texts()), 'search filters rows')
    pg.get_by_label('Rechercher').fill('zzzzzz-introuvable')
    pg.get_by_text('Aucune question.').wait_for()
    check(True, 'search with no hit shows « Aucune question. »')
    pg.get_by_label('Rechercher').fill('')
    pg.get_by_label('Thème', exact=True).first.select_option(label=f'{THEME} (1)')
    pg.locator('tbody tr').first.wait_for()
    check(pg.locator('tbody tr').count() == 1, 'theme filter keeps only the test theme')

    # --- edit ----------------------------------------------------------------------------------
    pg.get_by_role('button', name='Modifier').click()
    pg.get_by_label('Réponse', exact=True).fill('Mont Blanc (4 806 m)')
    shot(pg, '4-edit-form')
    pg.get_by_role('button', name='Enregistrer').click()
    pg.locator('tr', has_text='Mont Blanc (4 806 m)').wait_for()
    check(True, 'edit saved and shown')

    # --- delete (in-page confirmation) ----------------------------------------------------------
    dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
    pg.get_by_role('button', name='Supprimer').click()
    pg.get_by_role('button', name='Non').click()
    check(pg.locator('tbody tr').count() == 1, '« Non » keeps the question')
    pg.get_by_role('button', name='Supprimer').click()
    shot(pg, '5-delete-confirm')
    pg.get_by_role('button', name='Oui, supprimer').click()
    pg.get_by_text('Aucune question.').wait_for()
    check(not dialogs, 'no window.confirm used')
    check(True, 'question deleted')
    pg.get_by_label('Thème', exact=True).first.select_option(label='Tous les thèmes')

    # --- import --------------------------------------------------------------------------------
    pg.get_by_role('tab', name='Import / export').click()
    good = {'questions': [
        {'theme': THEME, 'question': 'Combien de pattes a une araignée ?', 'answer': '8', 'variants': ['huit']},
        {'theme': THEME, 'question': 'Quel gaz les plantes absorbent-elles ?', 'answer': 'Le CO2', 'variants': []},
        {'theme': THEME, 'question': 'COMBIEN de pattes a une araignée ?', 'answer': 'doublon', 'variants': []},
        {'theme': THEME, 'question': '', 'answer': 'x', 'variants': []},
    ]}
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d) / 'import.json'
        f.write_text(json.dumps(good))
        pg.set_input_files('#imp-file', str(f))
    pg.get_by_text('3 questions valides, 1 erreur').wait_for()
    check(pg.locator('.adm-chips li', has_text=f'{THEME} · 3').count() == 1, 'preview shows per-theme counts')
    check(pg.locator('.adm-errors li', has_text='Question 4').count() == 1, 'preview lists the invalid entry')
    shot(pg, '6-import-preview')
    pg.get_by_role('button', name='Importer', exact=True).click()
    pg.get_by_text('Import terminé').wait_for()
    report = pg.locator('.adm-report').inner_text()
    check('2 ajoutées, 1 doublon ignoré, 0 erreur' in report, f'import report: {report!r}')
    check(pg.locator('#imp-source').input_value() == 'généré', 'import source defaults to « Généré par Claude » for a file')
    found = api.get('/api/admin/questions', params={'q': 'araignée'}).json()['items']
    check(found and all(it['source'] == 'généré' for it in found), 'imported questions are tagged « généré »')
    shot(pg, '7-import-done')

    # pasted JSON + invalid + too many
    pg.locator('#imp-text').fill('{pas du json')
    pg.get_by_text("n'est pas du JSON valide").wait_for()
    check(pg.get_by_role('button', name='Importer', exact=True).is_disabled(), 'import disabled on invalid JSON')
    pg.locator('#imp-text').fill(json.dumps({'questions': [{'theme': 't', 'question': 'q', 'answer': 'a'}] * 1001}))
    pg.get_by_text('Trop de questions : 1000 au maximum par import.').wait_for()
    check(True, 'more than 1000 questions refused client-side')
    pg.locator('#imp-text').fill('')

    # --- export --------------------------------------------------------------------------------
    with pg.expect_download() as dl:
        pg.get_by_role('button', name='Exporter la banque').click()
    name = dl.value.suggested_filename
    check(len(name) == len('questions-2026-01-01.json') and name.startswith('questions-') and name.endswith('.json'), f'export filename {name}')
    exported = json.loads(pathlib.Path(dl.value.path()).read_text())
    check(any(q['question'] == 'Combien de pattes a une araignée ?' and q['variants'] == ['huit'] for q in exported['questions']), 'export contains the imported question')

    # --- words ---------------------------------------------------------------------------------
    pg.get_by_role('tab', name='Mots du Pictionary').click()
    box = pg.locator('#words-text')
    expect(box).to_be_enabled()
    box.fill('zèbre\nlicorne\n\nZEBRE\nfusée')
    pg.get_by_text('4 mots').wait_for()
    shot(pg, '8-words')
    pg.get_by_role('button', name='Enregistrer').click()
    pg.get_by_text('3 mots enregistrés.').wait_for()
    check(sorted(api.get('/api/admin/words').json()['words']) == sorted(['zèbre', 'licorne', 'fusée']), 'words saved (blank lines and duplicates dropped)')

    # --- logout --------------------------------------------------------------------------------
    pg.get_by_role('button', name='Se déconnecter').click()
    pg.get_by_label('Mot de passe').wait_for()
    check(True, 'logout returns to the login form')
    pg.reload()
    pg.get_by_label('Mot de passe').wait_for()
    check(True, 'logged out after reload')

    check(not errors, f'no page errors {errors}')

    # --- cleanup -------------------------------------------------------------------------------
    api.put('/api/admin/words', data={'words': original_words})
    purge(api)
    api.dispose()
    browser.close()

print(f'\n{len(failures)} failure(s)' if failures else '\nall checks passed')
raise SystemExit(1 if failures else 0)
