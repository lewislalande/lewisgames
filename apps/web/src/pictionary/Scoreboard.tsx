import type { StateMsg } from '../lib/socket';

export function Scoreboard({ state, playerId }: { state: StateMsg; playerId: string }) {
  const rows = state.players
    .map((p) => ({ ...p, score: state.game.scores[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  return (
    <section className="card players">
      <h2>Joueurs</h2>
      <ul className="player-list">
        {rows.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'away'}>
            <span className="player-name">
              {p.id === state.hostId && <span className="crown" title="Hôte" aria-label="Hôte">♛</span>}
              {p.name}
              {p.id === playerId && <span className="you"> (toi)</span>}
              {!p.connected && <span className="you"> (absent)</span>}
            </span>
            <span className="score">{p.score}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
