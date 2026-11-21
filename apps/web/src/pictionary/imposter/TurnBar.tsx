import type { ImposterView, PictionaryView, PlayerInfo } from '@kg/shared';
import { useServerNow } from '../Timer';

export function Dot({ color }: { color: string | undefined }) {
  return <span className="imp-dot" style={{ background: color ?? 'transparent' }} aria-hidden="true" />;
}

type Props = {
  game: PictionaryView;
  imp: ImposterView;
  players: PlayerInfo[];
  hostId: string | null;
  playerId: string;
  offset: number;
};

/** The manche's turn order with each player's colour and score; the current drawer is highlighted with a countdown. */
export function TurnBar({ game, imp, players, hostId, playerId, offset }: Props) {
  const now = useServerNow(offset);
  const byId = new Map(players.map((p) => [p.id, p]));
  // Players who joined mid-manche come last, without a colour.
  const ids = [...imp.order, ...players.filter((p) => !imp.order.includes(p.id)).map((p) => p.id)];
  const left = game.phaseEndsAt === null ? 0 : Math.max(0, Math.ceil((game.phaseEndsAt - now) / 1000));
  return (
    <section className="card turn-bar" aria-label="Ordre de passage">
      <h2>Ordre de passage</h2>
      <p className="turn-round">Tour de table {imp.tableRound}/{imp.tableRounds}</p>
      <ul className="player-list">
        {ids.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          const current = id === imp.currentDrawer;
          return (
            <li key={id} className={`${p.connected ? '' : 'away'}${id === playerId ? ' me' : ''}${current ? ' current' : ''}`} data-player={p.name}>
              <Dot color={imp.colors[id]} />
              <span className="player-name">
                {id === hostId && <span className="crown" title="Hôte" aria-label="Hôte">♛</span>}
                {current && <span className="mark" title="Dessine" aria-label="Dessine">✎ </span>}
                {game.phase === 'impVote' && imp.voted.includes(id) && <span className="mark ok" title="A voté" aria-label="A voté">✓ </span>}
                {p.name}
                {id === playerId && <span className="you"> (toi)</span>}
                {!p.connected && <span className="you"> (absent)</span>}
              </span>
              {current && <span className="turn-left" aria-hidden="true">{left}s</span>}
              <span className="score">{game.scores[id] ?? 0}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
