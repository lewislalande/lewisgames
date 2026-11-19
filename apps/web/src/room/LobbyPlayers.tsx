import type { PlayerInfo } from '@kg/shared';
import { PlayerRow } from './PlayerRow';

type Props = { players: PlayerInfo[]; hostId: string | null; playerId: string; maxPlayers: number };

/** The lobby's « Joueurs (n/max) » card. */
export function LobbyPlayers({ players, hostId, playerId, maxPlayers }: Props) {
  return (
    <section className="card players">
      <h2>Joueurs ({players.length}/{maxPlayers})</h2>
      <ul className="player-list">
        {players.map((p) => (
          <PlayerRow key={p.id} player={p} isHost={p.id === hostId} isMe={p.id === playerId} />
        ))}
      </ul>
    </section>
  );
}
