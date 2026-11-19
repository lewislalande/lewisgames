import type { ClientMsg } from '@kg/shared';
import type { QuizStateMsg } from '../lib/socket';
import { GameOverCard } from '../room/GameOverCard';
import { formatPoints } from './format';

type Props = { state: QuizStateMsg; playerId: string; send: (m: ClientMsg) => void };

export function QuizGameOver({ state, playerId, send }: Props) {
  return (
    <GameOverCard
      players={state.players}
      scores={state.game.scores}
      hostId={state.hostId}
      playerId={playerId}
      onRestart={() => send({ t: 'restart' })}
      format={formatPoints}
    />
  );
}
