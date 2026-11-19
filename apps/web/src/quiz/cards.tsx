import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { VoteValue } from '@kg/shared';
import { formatRate } from './format';

export const VOTES: { value: VoteValue; icon: string; label: string }[] = [
  { value: 'yes', icon: '✅', label: 'Correct' },
  { value: 'half', icon: '½', label: 'À moitié' },
  { value: 'no', icon: '❌', label: 'Faux' },
];

const authorList = (authors: string[], names: Record<string, string>) => authors.map((a) => names[a] ?? '?').join(', ');

type AnswerProps = {
  text: string;
  authors: string[];
  names: Record<string, string>;
  /** Index in the list, for the staggered colours. */
  index: number;
  className?: string;
  children?: ReactNode;
};

/** One player answer (a group of identical answers) with its authors. */
export function AnswerCard({ text, authors, names, index, className = '', children }: AnswerProps) {
  return (
    <li className={`qz-answer tone-${index % 4} ${className}`}>
      <div className="qz-answer-main">
        <span className="qz-answer-text">{text}</span>
        <span className="qz-authors">{authorList(authors, names)}</span>
      </div>
      {children}
    </li>
  );
}

/** The reviewed question (big) above the pinned correct answer; shared by the voting and result pages. */
export function ReviewHead({ game }: { game: { question: { text: string } | null; correct: { answer: string; variants: string[] } | null } }) {
  return (
    <div className="qz-pinned">
      {game.question && <p className="qz-review-question">{game.question.text}</p>}
      {game.correct && <CorrectCard correct={game.correct} />}
    </div>
  );
}

/** The big green « Bonne réponse » card, with the accepted variants in small. */
export function CorrectCard({ correct }: { correct: { answer: string; variants: string[] } }) {
  return (
    <div className="qz-correct" role="status">
      <p className="qz-correct-main">Bonne réponse : <strong>{correct.answer}</strong></p>
      {correct.variants.length > 0 && <p className="qz-variants">Aussi accepté : {correct.variants.join(', ')}</p>}
    </div>
  );
}

type VoteProps = { value: VoteValue | undefined; onVote: (v: VoteValue) => void; disabled?: boolean };

/** ✅ / ½ / ❌, the chosen one highlighted. */
export function VoteButtons({ value, onVote, disabled }: VoteProps) {
  return (
    <div className="qz-votes" role="group" aria-label="Ton vote">
      {VOTES.map((v) => (
        <button
          key={v.value}
          type="button"
          className={`vote-btn vote-${v.value}`}
          aria-label={v.label}
          title={v.label}
          aria-pressed={value === v.value}
          disabled={disabled}
          onClick={() => onVote(v.value)}
        >
          {v.icon}
        </button>
      ))}
    </div>
  );
}

/** Bottom bar of the notebook: a status line and, for the host, the action button. */
export function QuizFoot({ children, action }: { children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="qz-foot">
      <p className="qz-status">{children}</p>
      {action}
    </div>
  );
}

/** Answering speed, hidden at ×1; pulses each time it rises (not on first display). */
export function SpeedChip({ rate }: { rate: number }) {
  const prev = useRef(rate);
  const [pulses, setPulses] = useState(0);
  useEffect(() => {
    if (rate > prev.current) setPulses((n) => n + 1);
    prev.current = rate;
  }, [rate]);
  if (rate <= 1) return null;
  return (
    <span key={pulses} className={`speed-chip${pulses > 0 ? ' pulse' : ''}`} title="Le temps s'accélère à mesure que les autres répondent">
      {formatRate(rate)}
    </span>
  );
}
