import { useState } from 'react';
import { isValidCode, type GameKind } from '@kg/shared';
import { fetchRoomGame, roomPath } from '../lib/rooms';

const GAMES: { game: GameKind; title: string; text: string }[] = [
  { game: 'pictionary', title: 'Pictionary', text: 'Dessine, devine, grimpe au classement. De 2 à 12 joueurs.' },
  { game: 'quiz', title: 'Quiz', text: 'Des questions, des points, un seul gagnant. De 2 à 12 joueurs.' },
];

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<GameKind | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function create(game: GameKind) {
    setBusy(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ game }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { code: c } = (await res.json()) as { code: string };
      location.assign(roomPath(game, c));
    } catch {
      setCreateError(game);
      setBusy(false);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setJoinError(null);
    if (!isValidCode(c)) {
      setJoinError("Cette salle n'existe pas.");
      return;
    }
    setBusy(true);
    const game = await fetchRoomGame(c);
    if (game === 'not_found' || game === null) {
      setJoinError(game === 'not_found' ? "Cette salle n'existe pas." : 'Impossible de trouver la salle. Réessaie dans un instant.');
      setBusy(false);
      return;
    }
    location.assign(roomPath(game, c));
  }

  return (
    <main className="home">
      <h1 className="logo">
        <span>L</span>Games
      </h1>
      <p className="tagline">Des jeux à plusieurs, sans compte, directement dans le navigateur.</p>

      <div className="games">
        {GAMES.map((g) => (
          <section key={g.game} className={`card card-game game-${g.game}`}>
            <span className="ring ring-l" aria-hidden="true" />
            <span className="ring ring-r" aria-hidden="true" />
            <h2>{g.title}</h2>
            <p>{g.text}</p>
            <button className="btn btn-primary" onClick={() => create(g.game)} disabled={busy}>
              Créer une salle
            </button>
            {createError === g.game && <p className="error" role="alert">Impossible de créer la salle. Réessaie dans un instant.</p>}
          </section>
        ))}
      </div>

      <form className="card join-card" onSubmit={join}>
        <label htmlFor="join-code">Rejoindre une salle</label>
        <div className="join-row">
          <input
            id="join-code"
            className="code-input"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setJoinError(null); }}
            placeholder="CODE"
            maxLength={5}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={!code.trim() || busy}>
            Rejoindre
          </button>
        </div>
        {joinError && <p className="error" role="alert">{joinError}</p>}
      </form>
    </main>
  );
}
