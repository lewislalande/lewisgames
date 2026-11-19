import type { ClientMsg, QuizView } from '@kg/shared';
import { AnswerCard, CorrectCard, QuizFoot } from './cards';

type Props = { game: QuizView; names: Record<string, string>; isHost: boolean; hostName: string; send: (m: ClientMsg) => void };

/** What the host's next click does. */
function nextLabel(game: QuizView): string {
  if (game.revealed.length < game.groupCount) return 'Suivant';
  if (!game.correct) return 'Montrer la réponse';
  return game.groupCount === 0 ? 'Voir les résultats' : 'Passer au vote';
}

export function Reveal({ game, names, isHost, hostName, send }: Props) {
  return (
    <>
      <div className="qz-page">
        <p className="qz-question qz-question-sm">{game.question?.text}</p>
        {game.groupCount === 0 && <p className="qz-empty">Personne n'a répondu.</p>}
        <ul className="qz-answers">
          {game.revealed.map((g, i) => (
            <AnswerCard key={g.groupId} text={g.text} authors={g.authors} names={names} index={i} className="qz-in" />
          ))}
        </ul>
        {game.correct && <CorrectCard correct={game.correct} />}
      </div>
      <QuizFoot
        action={isHost && <button className="btn btn-primary" onClick={() => send({ t: 'next' })}>{nextLabel(game)}</button>}
      >
        {game.groupCount > 0 && <span className="qz-count">{game.revealed.length}/{game.groupCount} réponses</span>}
        {!isHost && `${hostName} fait défiler les réponses…`}
      </QuizFoot>
    </>
  );
}
