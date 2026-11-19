import { isBlankAnswer, type QuizPhase, type QuizState } from './game';
import type { QuizSettings } from './settings';
import type { VoteValue } from './grouping';

export type QuizView = {
  phase: QuizPhase;
  settings: QuizSettings;
  /** 1-based; 0 in the lobby. */
  questionNumber: number;
  questionCount: number;
  question: { theme: string; text: string } | null;
  /** PlayerIds who submitted a non-blank answer (see isBlankAnswer). */
  answered: string[];
  myAnswer: string | null;
  /** Only the groups revealed so far. */
  revealed: { groupId: string; text: string; authors: string[] }[];
  /** Only once the host showed it. */
  correct: { answer: string; variants: string[] } | null;
  myVotes: Record<string, VoteValue>;
  /** Only in deciding / result. */
  voteCounts: Record<string, Record<VoteValue, number>> | null;
  pendingVoters: string[];
  /** GroupIds awaiting the host's decision (deciding). */
  ties: string[];
  outcomes: Record<string, VoteValue>;
  questionPoints: Record<string, number>;
  scores: Record<string, number>;
  phaseEndsAt: number | null;
  serverNow: number;
};

const IN_QUESTION: QuizPhase[] = ['answering', 'revealing', 'voting', 'deciding', 'result'];

export function quizViewFor(s: QuizState, viewerId: string, now: number): QuizView {
  const current = IN_QUESTION.includes(s.phase) ? s.questions[s.index] : undefined;
  const showCounts = s.phase === 'deciding' || s.phase === 'result';
  const myVotes: Record<string, VoteValue> = {};
  for (const [groupId, byVoter] of Object.entries(s.votes)) {
    const v = byVoter[viewerId];
    if (v !== undefined) myVotes[groupId] = v;
  }
  return {
    phase: s.phase,
    settings: s.settings,
    questionNumber: s.phase === 'lobby' ? 0 : s.index + 1,
    questionCount: s.questions.length,
    question: current ? { theme: current.theme, text: current.question } : null,
    answered: Object.keys(s.answers).filter((id) => !isBlankAnswer(s.answers[id])),
    myAnswer: s.answers[viewerId] ?? null,
    revealed: s.groups.slice(0, s.revealedCount).map((g) => ({ groupId: g.id, text: g.text, authors: g.authors })),
    correct: current && s.answerShown ? { answer: current.answer, variants: current.variants } : null,
    myVotes,
    voteCounts: showCounts
      ? Object.fromEntries(s.groups.map((g) => {
        const counts: Record<VoteValue, number> = { yes: 0, half: 0, no: 0 };
        for (const v of Object.values(s.votes[g.id] ?? {})) counts[v]++;
        return [g.id, counts];
      }))
      : null,
    pendingVoters: s.phase === 'voting' ? s.pendingVoters : [],
    ties: s.phase === 'deciding' ? s.groups.filter((g) => s.outcomes[g.id] === undefined).map((g) => g.id) : [],
    outcomes: s.outcomes,
    questionPoints: s.questionPoints,
    scores: s.scores,
    phaseEndsAt: s.phaseEndsAt,
    serverNow: now,
  };
}
