import type { PictionaryStateMsg } from '../lib/socket';
import { PlayerRow } from '../room/PlayerRow';

export function Scoreboard({ state, playerId }: { state: PictionaryStateMsg; playerId: string }) {
  const rows = state.players
    .map((p) => ({ ...p, score: state.game.scores[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  return (
    <section className="card players">
      <h2>Joueurs</h2>
      <ul className="player-list">
        {rows.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            isHost={p.id === state.hostId}
            isMe={p.id === playerId}
            marks={
              <>
                {state.game.phase !== 'lobby' && p.id === state.game.drawerId && <span className="mark" title="Dessine" aria-label="Dessine">✎ </span>}
                {state.game.found.includes(p.id) && <span className="mark ok" title="A trouvé" aria-label="A trouvé">✓ </span>}
              </>
            }
            aside={<span className="score">{p.score}</span>}
          />
        ))}
      </ul>
    </section>
  );
}
