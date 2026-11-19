import type { PictionaryView } from '@kg/shared';

type Props = { game: PictionaryView; names: Record<string, string> };

export function TurnEnd({ game, names }: Props) {
  const rows = Object.keys(names)
    .map((id) => ({ id, name: names[id], pts: game.turnPoints[id] ?? 0 }))
    .sort((a, b) => b.pts - a.pts);
  return (
    <div className="overlay">
      <div className="overlay-card" role="dialog" aria-label="Fin du tour">
        <h2>{game.word ? `Le mot était : ${game.word}` : 'Le dessinateur est parti'}</h2>
        <ul className="player-list">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="player-name">{r.name}</span>
              <span className="score">+{r.pts}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
