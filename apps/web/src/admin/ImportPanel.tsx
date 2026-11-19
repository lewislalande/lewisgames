import { useMemo, useState } from 'react';
import { parseImport, type ImportedQuestion } from '@kg/shared';
import { adminApi, type ImportReport, type ImportSource } from './api';

const MAX_IMPORT = 1000;
const TOO_MANY = `Trop de questions : ${MAX_IMPORT} au maximum par import.`;

type Parsed = { ok: ImportedQuestion[]; errors: { index: number; reason: string }[] };

function parseText(text: string): Parsed | null {
  if (!text.trim()) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: [], errors: [{ index: -1, reason: "ce texte n'est pas du JSON valide" }] };
  }
  const list = (json as { questions?: unknown } | null)?.questions;
  if (Array.isArray(list) && list.length > MAX_IMPORT) return { ok: [], errors: [{ index: -1, reason: TOO_MANY }] };
  return parseImport(json);
}

const today = () => new Date().toISOString().slice(0, 10);

export function ImportPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState<ImportSource>('généré');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const parsed = useMemo(() => parseText(text), [text]);
  const perTheme = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of parsed?.ok ?? []) m.set(q.theme, (m.get(q.theme) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [parsed]);

  function change(value: string) {
    setText(value);
    setReport(null);
    setFailure(null);
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSource('généré');
    change(await file.text());
  }

  async function run() {
    if (!parsed?.ok.length) return;
    setBusy(true);
    setFailure(null);
    const res = await adminApi.importQuestions(parsed.ok, source);
    setBusy(false);
    if (res.ok) return setReport(res.data);
    if (res.unauthorized) return onUnauthorized();
    setFailure(res.error === 'too_many' ? TOO_MANY : "L'import a échoué. Réessaie dans un instant.");
  }

  async function exportBank() {
    setFailure(null);
    const res = await adminApi.exportQuestions();
    if (!res.ok) {
      if (res.unauthorized) return onUnauthorized();
      return setFailure("L'export a échoué. Réessaie dans un instant.");
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `questions-${today()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="adm-two">
      <section className="card adm-card" aria-label="Importer">
        <h2>Importer des questions</h2>
        <p className="muted">
          Format : {'{"questions":[{"theme":"…","question":"…","answer":"…","variants":["…"]}]}'}. Les doublons sont ignorés.
        </p>
        <div className="adm-field">
          <label htmlFor="imp-file">Choisir un fichier .json</label>
          <input id="imp-file" type="file" accept=".json,application/json" onChange={(e) => void pickFile(e)} />
        </div>
        <div className="adm-field">
          <label htmlFor="imp-text">…ou coller le JSON</label>
          <textarea id="imp-text" rows={10} spellCheck={false} value={text} onChange={(e) => change(e.target.value)} />
        </div>

        <div className="adm-field">
          <label htmlFor="imp-source">Source des questions</label>
          <select id="imp-source" className="adm-select" value={source} onChange={(e) => setSource(e.target.value as ImportSource)}>
            <option value="généré">Généré par Claude</option>
            <option value="manuel">Manuel</option>
          </select>
        </div>

        {parsed && (
          <div className="adm-preview" aria-label="Aperçu">
            <p className="adm-preview-title">
              {parsed.ok.length} question{parsed.ok.length > 1 ? 's' : ''} valide{parsed.ok.length > 1 ? 's' : ''}
              {parsed.errors.length > 0 && `, ${parsed.errors.length} erreur${parsed.errors.length > 1 ? 's' : ''}`}
            </p>
            {perTheme.length > 0 && (
              <ul className="adm-chips">{perTheme.map(([t, n]) => <li key={t}>{t} · {n}</li>)}</ul>
            )}
            {parsed.errors.length > 0 && (
              <ul className="adm-errors">
                {parsed.errors.map((er, i) => (
                  <li key={i}>{er.index < 0 ? er.reason : `Question ${er.index + 1} : ${er.reason}`}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {failure && <p className="error" role="alert">{failure}</p>}
        {report && (
          <div className="adm-report" role="status">
            <p className="adm-preview-title">Import terminé</p>
            <p>{report.inserted} ajoutée{report.inserted > 1 ? 's' : ''}, {report.duplicates} doublon{report.duplicates > 1 ? 's' : ''} ignoré{report.duplicates > 1 ? 's' : ''}, {report.errors.length} erreur{report.errors.length > 1 ? 's' : ''}.</p>
          </div>
        )}
        <div className="adm-actions">
          <button className="btn btn-primary" type="button" disabled={busy || !parsed?.ok.length} onClick={() => void run()}>Importer</button>
        </div>
      </section>

      <section className="card adm-card" aria-label="Exporter">
        <h2>Exporter</h2>
        <p className="muted">Télécharge toute la banque de questions au même format que l'import.</p>
        <div className="adm-actions">
          <button className="btn" type="button" onClick={() => void exportBank()}>Exporter la banque</button>
        </div>
      </section>
    </div>
  );
}
