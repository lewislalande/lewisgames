import type { ClientMsg, ImposterView, PlayerInfo } from '@kg/shared';
import { Dot } from './TurnBar';

type Props = { imp: ImposterView; players: PlayerInfo[]; playerId: string; send: (m: ClientMsg) => void };

/** One button per other player of the manche (the vote can change until everyone has voted). */
export function Vote({ imp, players, playerId, send }: Props) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const canVote = imp.order.includes(playerId);
  const waiting = imp.order.filter((id) => !imp.voted.includes(id) && byId.get(id)?.connected).map((id) => byId.get(id)!.name);
  return (
    <section className="card imp-phase" aria-label="Vote">
      <h2>Vote</h2>
      <p>Qui est l'imposteur ?</p>
      {canVote ? (
        <div className="vote-list">
          {imp.order.filter((id) => id !== playerId && byId.has(id)).map((id) => (
            <button
              key={id}
              type="button"
              className={`btn vote-player${imp.myVote === id ? ' on' : ''}`}
              aria-pressed={imp.myVote === id}
              onClick={() => send({ t: 'impVote', target: id })}
            >
              <Dot color={imp.colors[id]} />
              <span>{byId.get(id)!.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Tu joueras à la prochaine manche.</p>
      )}
      {waiting.length > 0 && <p className="muted vote-waiting">En attente : {waiting.join(', ')}</p>}
    </section>
  );
}
