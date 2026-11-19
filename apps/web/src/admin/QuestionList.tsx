import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportedQuestion } from '@kg/shared';
import { adminApi, type QuestionPage, type ThemeCount } from './api';
import { QuestionForm } from './QuestionForm';

const SEARCH_DELAY_MS = 300;

const date = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleDateString('fr-FR'));

type Props = { onUnauthorized: () => void };

export function QuestionList({ onUnauthorized }: Props) {
  const [themes, setThemes] = useState<ThemeCount[]>([]);
  const [theme, setTheme] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<QuestionPage | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => { setQ(search.trim()); setPage(1); }, SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    const n = ++latest.current;
    const res = await adminApi.listQuestions({ theme, q, page });
    if (n !== latest.current) return; // a newer request supersedes this one
    if (res.ok) {
      setData(res.data);
      setLoadError(false);
      // The server clamps a page past the end (e.g. after deleting the last row of the last page).
      if (res.data.page !== page) setPage(res.data.page);
    } else if (res.unauthorized) onUnauthorized();
    else setLoadError(true);
  }, [theme, q, page, onUnauthorized]);

  useEffect(() => { void load(); }, [load]);

  const loadThemes = useCallback(async () => {
    const res = await adminApi.themes();
    if (res.ok) setThemes(res.data);
  }, []);
  useEffect(() => { void loadThemes(); }, [loadThemes]);

  async function save(call: Promise<Awaited<ReturnType<typeof adminApi.createQuestion>>>): Promise<string | null> {
    const res = await call;
    if (res.ok) {
      setAdding(false);
      setEditing(null);
      setNotice('Question enregistrée.');
      void load();
      void loadThemes();
      return null;
    }
    if (res.unauthorized) { onUnauthorized(); return null; }
    if (res.error === 'duplicate') return 'Cette question existe déjà.';
    if (res.error === 'invalid') return `Question invalide : ${res.reason ?? 'vérifie les champs'}.`;
    return "Impossible d'enregistrer. Réessaie dans un instant.";
  }

  async function remove(id: number) {
    const res = await adminApi.deleteQuestion(id);
    setConfirming(null);
    if (!res.ok && res.unauthorized) return onUnauthorized();
    // not_found: someone else already deleted it; the refreshed list says so.
    setNotice(res.ok || res.error === 'not_found' ? 'Question supprimée.' : 'Impossible de supprimer. Réessaie.');
    void load();
    void loadThemes();
  }

  const themeNames = themes.map((t) => t.theme);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="card adm-card" aria-label="Questions">
      <div className="adm-toolbar">
        <div className="adm-field adm-grow">
          <label htmlFor="adm-search">Rechercher</label>
          <input id="adm-search" type="text" placeholder="Dans la question ou la réponse…" value={search} autoComplete="off" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="adm-field">
          <label htmlFor="adm-theme">Thème</label>
          <select id="adm-theme" className="adm-select" value={theme} onChange={(e) => { setTheme(e.target.value); setPage(1); }}>
            <option value="">Tous les thèmes</option>
            {themes.map((t) => <option key={t.theme} value={t.theme}>{t.theme} ({t.count})</option>)}
          </select>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => { setAdding(true); setEditing(null); setNotice(null); }} disabled={adding}>+ Ajouter une question</button>
      </div>

      {notice && <p className="adm-notice" role="status">{notice}</p>}
      {adding && (
        <div className="adm-edit">
          <h3>Nouvelle question</h3>
          <QuestionForm themes={themeNames} onSave={(qn: ImportedQuestion) => save(adminApi.createQuestion(qn))} onCancel={() => setAdding(false)} />
        </div>
      )}

      {loadError && <p className="error" role="alert">Impossible de charger les questions.</p>}
      {data && (
        <>
          <p className="muted adm-count">{data.total} question{data.total > 1 ? 's' : ''}</p>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr><th>Thème</th><th>Question</th><th>Réponse</th><th>Variantes</th><th>Source</th><th>Dernière utilisation</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={7} className="adm-empty">Aucune question.</td></tr>}
                {data.items.map((it) =>
                  editing === it.id ? (
                    <tr key={it.id} className="adm-editing">
                      <td colSpan={7}>
                        <QuestionForm initial={it} themes={themeNames} onSave={(qn) => save(adminApi.updateQuestion(it.id, qn))} onCancel={() => setEditing(null)} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={it.id}>
                      <td><span className="adm-theme">{it.theme}</span></td>
                      <td className="adm-q">{it.question}</td>
                      <td className="adm-a">{it.answer}</td>
                      <td className="adm-v">{it.variants.join(', ') || '—'}</td>
                      <td>{it.source}</td>
                      <td>{date(it.lastUsedAt)}</td>
                      <td className="adm-row-actions">
                        {confirming === it.id ? (
                          <span className="adm-confirm" role="group" aria-label="Confirmer la suppression">
                            <span>Supprimer ?</span>
                            <button className="btn btn-danger btn-sm" type="button" onClick={() => void remove(it.id)}>Oui, supprimer</button>
                            <button className="btn btn-sm" type="button" onClick={() => setConfirming(null)}>Non</button>
                          </span>
                        ) : (
                          <>
                            <button className="btn btn-sm" type="button" onClick={() => { setEditing(it.id); setAdding(false); setNotice(null); }}>Modifier</button>
                            <button className="btn btn-sm" type="button" onClick={() => setConfirming(it.id)}>Supprimer</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className="adm-pager" aria-label="Pagination">
              <button className="btn btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button>
              <span>Page {page} / {pages}</span>
              <button className="btn btn-sm" type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
