import type { QuizView } from '@kg/shared';

/** The 1-second pause between two questions (questionNumber is still the one just answered). */
export function Transition({ game }: { game: QuizView }) {
  return (
    <div className="qz-page qz-page-center qz-transition" role="status">
      <p className="qz-transition-title">Question suivante…</p>
      <p className="qz-transition-next">Question {game.questionNumber + 1}/{game.questionCount}</p>
    </div>
  );
}
