import { useEffect, useState } from 'react';
import { adminApi } from './api';

const lines = (text: string) => text.split('\n').map((w) => w.trim()).filter(Boolean);

export function WordsPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void adminApi.getWords().then((res) => {
      if (res.ok) { setText(res.data.words.join('\n')); setLoaded(true); }
      else if (res.unauthorized) onUnauthorized();
      else setMessage({ ok: false, text: 'Impossible de charger les mots.' });
    });
  }, [onUnauthorized]);

  async function save() {
    setBusy(true);
    setMessage(null);
    const res = await adminApi.putWords(lines(text));
    setBusy(false);
    if (res.ok) {
      setMessage({ ok: true, text: `${res.data.count} mot${res.data.count > 1 ? 's' : ''} enregistré${res.data.count > 1 ? 's' : ''}.` });
      const fresh = await adminApi.getWords();
      if (fresh.ok) setText(fresh.data.words.join('\n'));
    } else if (res.unauthorized) onUnauthorized();
    else setMessage({ ok: false, text: res.reason ? `Refusé : ${res.reason}.` : "Impossible d'enregistrer. Réessaie." });
  }

  const n = lines(text).length;
  return (
    <section className="card adm-card adm-narrow" aria-label="Mots du Pictionary">
      <h2>Mots du Pictionary</h2>
      <p className="muted">Un mot par ligne. Remplace toute la liste à l'enregistrement.</p>
      <label htmlFor="words-text" className="sr-only">Mots</label>
      <textarea id="words-text" rows={18} spellCheck={false} disabled={!loaded} value={text} onChange={(e) => { setText(e.target.value); setMessage(null); }} />
      <p className="adm-count">{n} mot{n > 1 ? 's' : ''}</p>
      {message && <p className={message.ok ? 'adm-notice' : 'error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
      <div className="adm-actions">
        <button className="btn btn-primary" type="button" disabled={busy || !loaded} onClick={() => void save()}>Enregistrer</button>
      </div>
    </section>
  );
}
