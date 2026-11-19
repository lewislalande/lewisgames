import { QUIZ_POINTS, type ClientMsg, type PlayerInfo, type QuizView } from '@kg/shared';
import { PlayerRow } from '../room/PlayerRow';
import { AnswerCard, QuizFoot, ReviewHead, VOTES } from './cards';
import { formatPoints } from './format';

type Props = {
  game: QuizView;
  players: PlayerInfo[];
  names: Record<string, string>;
  playerId: string;
  hostId: string | null;
  hostName: string;
  send: (m: ClientMsg) => void;
};

export function QuestionResult({ game, players, names, playerId, hostId, hostName, send }: Props) {
  const isHost = hostId === playerId;
  const last = game.questionNumber >= game.questionCount;
  const ranking = players
    .map((p) => ({ ...p, score: game.scores[p.id] ?? 0, gained: game.questionPoints[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  return (
    <>
      <div className="qz-page">
        <ReviewHead game={game} />
        {game.revealed.length === 0 && <p className="qz-empty">Personne n'a répondu.</p>}
        <ul className="qz-answers">
          {game.revealed.map((g, i) => {
            const outcome = game.outcomes[g.groupId] ?? 'no';
            const v = VOTES.find((x) => x.value === outcome)!;
            return (
              <AnswerCard key={g.groupId} text={g.text} authors={g.authors} names={names} index={i}>
                <span className={`qz-outcome out-${outcome}`}>{v.icon} {v.label}</span>
                <span className="qz-points">+{formatPoints(QUIZ_POINTS[outcome])}</span>
              </AnswerCard>
            );
          })}
        </ul>
        <h2 className="qz-subtitle">Classement</h2>
        <ul className="player-list qz-ranking">
          {ranking.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              isHost={p.id === hostId}
              isMe={p.id === playerId}
              aside={
                <>
                  <span className="qz-gained">+{formatPoints(p.gained)}</span>
                  <span className="score">{formatPoints(p.score)}</span>
                </>
              }
            />
          ))}
        </ul>
      </div>
      <QuizFoot
        action={isHost && (
          <button className="btn btn-primary" onClick={() => send({ t: 'next' })}>{last ? 'Voir le classement' : 'Question suivante'}</button>
        )}
      >
        {!isHost && `En attente de ${hostName}…`}
      </QuizFoot>
    </>
  );
}
