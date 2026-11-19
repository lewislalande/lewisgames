import type { ClientMsg } from '@kg/shared';
import type { StateMsg } from '../lib/socket';

type Props = { state: StateMsg; playerId: string; send: (m: ClientMsg) => void };

export function GameOver({ state, playerId, send }: Props) {
  const rows = state.players
    .map((p) => ({ ...p, score: state.game.scores[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const isHost = state.hostId === playerId;
  // Podium order: 2nd, 1st, 3rd.
  const podium = [1, 0, 2].map((i) => ({ rank: i + 1, p: rows[i] })).filter((x) => x.p);
  return (
    <section className="card gameover">
      <h1 className="title-sm">Partie terminée !</h1>
      <div className="podium">
        {podium.map(({ rank, p }) => (
          <div key={p.id} className={`pod pod-${rank}`}>
            <span className="pod-name">{p.name}</span>
            <span className="pod-score">{p.score}</span>
            <div className="pod-step">{rank}</div>
          </div>
        ))}
      </div>
      <ol className="final-list">
        {rows.map((p) => (
          <li key={p.id}>
            <span className="player-name">
              {p.name}
              {p.id === playerId && <span className="you"> (toi)</span>}
            </span>
            <span className="score">{p.score}</span>
          </li>
        ))}
      </ol>
      <div className="gameover-actions">
        {isHost ? (
          <button className="btn btn-primary btn-big" onClick={() => send({ t: 'restart' })}>Rejouer</button>
        ) : (
          <p className="muted">En attente de l'hôte…</p>
        )}
        <a className="btn" href="/">Accueil</a>
      </div>
    </section>
  );
}
