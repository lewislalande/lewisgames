import { useState } from 'react';

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ game: 'pictionary' }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { code: c } = (await res.json()) as { code: string };
      location.assign(`/pictionary/${c}`);
    } catch {
      setError('Impossible de créer la salle. Réessaie dans un instant.');
      setBusy(false);
    }
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) location.assign(`/pictionary/${encodeURIComponent(c)}`);
  }

  return (
    <main className="home">
      <h1 className="logo">
        <span>K</span>Games
      </h1>
      <p className="tagline">Des jeux à plusieurs, sans compte, directement dans le navigateur.</p>

      <div className="games">
        <section className="card card-game">
          <span className="ring ring-l" aria-hidden="true" />
          <span className="ring ring-r" aria-hidden="true" />
          <h2>Pictionary</h2>
          <p>Dessine, devine, grimpe au classement. De 2 à 12 joueurs.</p>
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            Créer une salle
          </button>
          {error && <p className="error" role="alert">{error}</p>}
          <form className="join" onSubmit={join}>
            <label htmlFor="join-code">Rejoindre</label>
            <div className="join-row">
              <input
                id="join-code"
                className="code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                maxLength={5}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="btn" type="submit" disabled={!code.trim()}>
                Rejoindre
              </button>
            </div>
          </form>
        </section>

        <section className="card card-soon" aria-disabled="true">
          <h2>Quiz</h2>
          <p>Des questions, des points, un seul gagnant.</p>
          <span className="badge">Bientôt</span>
        </section>
      </div>
    </main>
  );
}
