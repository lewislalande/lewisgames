import { useState } from 'react';
import { IMPORT_LIMITS, type ImportedQuestion } from '@kg/shared';

type Props = {
  initial?: ImportedQuestion;
  themes: string[];
  /** Resolves to an error message to show, or null once saved. */
  onSave: (q: ImportedQuestion) => Promise<string | null>;
  onCancel: () => void;
};

export function QuestionForm({ initial, themes, onSave, onCancel }: Props) {
  const [theme, setTheme] = useState(initial?.theme ?? '');
  const [question, setQuestion] = useState(initial?.question ?? '');
  const [answer, setAnswer] = useState(initial?.answer ?? '');
  const [variants, setVariants] = useState((initial?.variants ?? []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await onSave({ theme, question, answer, variants: variants.split('\n').map((v) => v.trim()).filter(Boolean) });
    // On success the parent closes the form: nothing left to update here.
    if (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form className="adm-form" onSubmit={submit}>
      <div className="adm-field adm-field-theme">
        <label htmlFor="qf-theme">Thème</label>
        <input id="qf-theme" type="text" list="qf-themes" value={theme} maxLength={IMPORT_LIMITS.theme} required autoComplete="off" onChange={(e) => setTheme(e.target.value)} />
        <datalist id="qf-themes">{themes.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
      <div className="adm-field adm-field-answer">
        <label htmlFor="qf-answer">Réponse</label>
        <input id="qf-answer" type="text" value={answer} maxLength={IMPORT_LIMITS.answer} required autoComplete="off" onChange={(e) => setAnswer(e.target.value)} />
      </div>
      <div className="adm-field adm-field-wide">
        <label htmlFor="qf-question">Question</label>
        <input id="qf-question" type="text" value={question} maxLength={IMPORT_LIMITS.question} required autoComplete="off" onChange={(e) => setQuestion(e.target.value)} />
      </div>
      <div className="adm-field adm-field-wide">
        <label htmlFor="qf-variants">Variantes acceptées (une par ligne)</label>
        <textarea id="qf-variants" rows={3} value={variants} onChange={(e) => setVariants(e.target.value)} />
      </div>
      {error && <p className="error adm-field-wide" role="alert">{error}</p>}
      <div className="adm-actions adm-field-wide">
        <button className="btn btn-primary" type="submit" disabled={busy}>Enregistrer</button>
        <button className="btn" type="button" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}
