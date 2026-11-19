import { isBlankAnswer, type QuizPhase, type QuizState } from './game';
import type { QuizSettings } from './settings';
import type { VoteValue } from './grouping';

export type QuizView = {
  phase: QuizPhase;
  settings: QuizSettings;
  /** 1-based: the question answered (answering / transition) or reviewed (voting / deciding / result); 0 in the lobby. */
  questionNumber: number;
  questionCount: number;
  question: { theme: string; text: string } | null;
  /** PlayerIds who submitted (not just drafted) a non-blank answer (see isBlankAnswer). */
  answered: string[];
  /** The viewer's latest text (draft or submitted). */
  myAnswer: string | null;
  /** True once the viewer submitted; false while their text is only a draft. */
  mySubmitted: boolean;
  /** True while a question is reviewed (voting / deciding / result). */
  reviewing: boolean;
  /** Every answer group of the reviewed question; empty outside the review. */
  revealed: { groupId: string; text: string; authors: string[] }[];
  /** The reviewed question's answer; null outside the review. */
  correct: { answer: string; variants: string[] } | null;
  myVotes: Record<string, VoteValue>;
  /** Only in deciding / result. */
  voteCounts: Record<string, Record<VoteValue, number>> | null;
  pendingVoters: string[];
  /** GroupIds whose authors vote on them too (everybody present authored them); voting only. */
  selfVoteGroups: string[];
  /** GroupIds awaiting the host's decision (deciding). */
  ties: string[];
  outcomes: Record<string, VoteValue>;
  questionPoints: Record<string, number>;
  /** {} until the first review result, then cumulative. */
  scores: Record<string, number>;
  phaseEndsAt: number | null;
  /** Answering speed: seconds left to show = (phaseEndsAt − now) × timeRate. 1 outside answering. */
  timeRate: number;
  serverNow: number;
};

const ANSWERING: QuizPhase[] = ['answering', 'transition'];
const REVIEWING: QuizPhase[] = ['voting', 'deciding', 'result'];

export function quizViewFor(s: QuizState, viewerId: string, now: number): QuizView {
  const reviewing = REVIEWING.includes(s.phase);
  const shownIndex = reviewing ? s.reviewIndex : ANSWERING.includes(s.phase) ? s.index : null;
  const current = shownIndex === null ? undefined : s.questions[shownIndex];
  const reviewed = reviewing ? current : undefined;
  // Scores stay hidden until the first question's result.
  const scoresShown = s.phase === 'gameOver' || s.phase === 'result' || (reviewing && s.reviewIndex > 0);
  const showCounts = s.phase === 'deciding' || s.phase === 'result';
  const myVotes: Record<string, VoteValue> = {};
  for (const [groupId, byVoter] of Object.entries(s.votes)) {
    const v = byVoter[viewerId];
    if (v !== undefined) myVotes[groupId] = v;
  }
  return {
    phase: s.phase,
    settings: s.settings,
    questionNumber: s.phase === 'lobby' ? 0 : (shownIndex ?? s.index) + 1,
    questionCount: s.questions.length,
    question: current ? { theme: current.theme, text: current.question } : null,
    answered: Object.keys(s.answers).filter((id) => s.submitted[id] === true && !isBlankAnswer(s.answers[id])),
    myAnswer: s.answers[viewerId] ?? null,
    mySubmitted: s.submitted[viewerId] === true && !isBlankAnswer(s.answers[viewerId]),
    reviewing,
    revealed: reviewing ? s.groups.map((g) => ({ groupId: g.id, text: g.text, authors: g.authors })) : [],
    correct: reviewed ? { answer: reviewed.answer, variants: reviewed.variants } : null,
    myVotes,
    voteCounts: showCounts
      ? Object.fromEntries(s.groups.map((g) => {
        const counts: Record<VoteValue, number> = { yes: 0, half: 0, no: 0 };
        for (const v of Object.values(s.votes[g.id] ?? {})) counts[v]++;
        return [g.id, counts];
      }))
      : null,
    pendingVoters: s.phase === 'voting' ? s.pendingVoters : [],
    selfVoteGroups: s.phase === 'voting' ? s.selfVoteGroups : [],
    ties: s.phase === 'deciding' ? s.groups.filter((g) => s.outcomes[g.id] === undefined).map((g) => g.id) : [],
    outcomes: s.outcomes,
    questionPoints: scoresShown ? s.questionPoints : {},
    scores: scoresShown ? s.scores : {},
    phaseEndsAt: s.phaseEndsAt,
    timeRate: s.phase === 'answering' ? s.timeRate : 1,
    serverNow: now,
  };
}
