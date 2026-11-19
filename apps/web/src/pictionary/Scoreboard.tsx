import type { StateMsg } from '../lib/socket';

const AVATAR_COLORS = ['#ff5f8f', '#ffb020', '#3ee0b0', '#4dc4ff', '#a98bff', '#ff8a4c', '#7ce35f', '#f06bd9'];
/** Stable colour per player id. */
export function avatarColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function Scoreboard({ state, playerId }: { state: StateMsg; playerId: string }) {
  const rows = state.players
    .map((p) => ({ ...p, score: state.game.scores[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  return (
    <section className="card players">
      <h2>Joueurs</h2>
      <ul className="player-list">
        {rows.map((p) => (
          <li key={p.id} className={`${p.connected ? '' : 'away'}${p.id === playerId ? ' me' : ''}`}>
            <span className="avatar" style={{ background: avatarColor(p.id) }} aria-hidden="true">{[...p.name][0]?.toUpperCase()}</span>
            <span className="player-name">
              {p.id === state.hostId && <span className="crown" title="Hôte" aria-label="Hôte">♛</span>}
              {state.game.phase !== 'lobby' && p.id === state.game.drawerId && <span className="mark" title="Dessine" aria-label="Dessine">✎ </span>}
              {state.game.found.includes(p.id) && <span className="mark ok" title="A trouvé" aria-label="A trouvé">✓ </span>}
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
