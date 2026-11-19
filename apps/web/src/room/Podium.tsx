type Row = { id: string; name: string; score: number };

type Props = { rows: Row[]; playerId: string; format?: (score: number) => string };

/** Top-3 podium (2nd, 1st, 3rd) over the full ranked list. `rows` must be sorted best first. */
export function Podium({ rows, playerId, format = String }: Props) {
  const podium = [1, 0, 2].map((i) => ({ rank: i + 1, p: rows[i] })).filter((x) => x.p);
  return (
    <>
      <div className="podium">
        {podium.map(({ rank, p }) => (
          <div key={p!.id} className={`pod pod-${rank}`}>
            <span className="pod-name">{p!.name}</span>
            <span className="pod-score">{format(p!.score)}</span>
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
            <span className="score">{format(p.score)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
