import type { QuizStateMsg } from '../lib/socket';
import { PlayerRow } from '../room/PlayerRow';
import { formatPoints } from './format';

export function QuizScoreboard({ state, playerId }: { state: QuizStateMsg; playerId: string }) {
  const { game } = state;
  // Names and ✓ only while answering; scores from the first review result on (the view sends {} before).
  const showScores = Object.keys(game.scores).length > 0;
  const rows = state.players
    .map((p) => ({ ...p, score: game.scores[p.id] ?? 0 }))
    .sort((a, b) => (showScores ? b.score - a.score : 0));
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
            marks={game.phase === 'answering' && game.answered.includes(p.id) && (
              <span className="mark ok" title="A répondu" aria-label="A répondu">✓ </span>
            )}
            aside={showScores && <span className="score">{formatPoints(p.score)}</span>}
          />
        ))}
      </ul>
    </section>
  );
}
