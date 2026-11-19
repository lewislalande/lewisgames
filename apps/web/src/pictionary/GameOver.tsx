import type { ClientMsg } from '@kg/shared';
import type { PictionaryStateMsg } from '../lib/socket';
import { GameOverCard } from '../room/GameOverCard';

type Props = { state: PictionaryStateMsg; playerId: string; send: (m: ClientMsg) => void };

export function GameOver({ state, playerId, send }: Props) {
  return (
    <GameOverCard
      players={state.players}
      scores={state.game.scores}
      hostId={state.hostId}
      playerId={playerId}
      onRestart={() => send({ t: 'restart' })}
    />
  );
}
