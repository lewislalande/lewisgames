import type { PictionaryView, QuizView } from '@kg/shared';
import type { SoundName } from '../lib/sound';

/** A phase change this close to (or past) the deadline was the timer running out. */
export const DEADLINE_SLACK_MS = 250;

const byDeadline = (a: { phaseEndsAt: number | null }, b: { serverNow: number }) =>
  a.phaseEndsAt !== null && b.serverNow >= a.phaseEndsAt - DEADLINE_SLACK_MS;

/** The sound for one quiz state change: own / others' submissions, time up, podium. */
export function quizSound(a: QuizView, b: QuizView, playerId: string): SoundName | null {
  if (b.phase === 'gameOver' && a.phase !== 'gameOver') return 'podium';
  if (a.phase !== 'answering') return null;
  if (b.phase !== 'answering') {
    if (byDeadline(a, b)) return 'timeUp';
    // Ended early: the last submission (which never shows in `answered`) completed it.
    return a.answered.includes(playerId) ? 'reveal' : 'submit';
  }
  if (a.questionNumber !== b.questionNumber) return null;
  const added = b.answered.filter((id) => !a.answered.includes(id));
  if (added.includes(playerId)) return 'submit';
  return added.length > 0 ? 'reveal' : null;
}

/** The sound for one Pictionary state change: turn start, someone found, time up, podium. */
export function pictionarySound(a: PictionaryView, b: PictionaryView): SoundName | null {
  if (b.phase === 'gameOver' && a.phase !== 'gameOver') return 'podium';
  if (b.imp) return imposterSound(a, b);
  if (b.phase === 'drawing' && a.phase !== 'drawing') return 'turnStart';
  if (a.phase !== 'drawing' || (b.phase !== 'drawing' && b.phase !== 'turnEnd')) return null;
  if (b.found.some((id) => !a.found.includes(id))) return 'found';
  return b.phase === 'turnEnd' && byDeadline(a, b) ? 'timeUp' : null;
}

/** Imposter mode: this player's turn to draw, the vote opening, one's own vote, the manche's result. */
function imposterSound(a: PictionaryView, b: PictionaryView): SoundName | null {
  if (b.phase === 'impDrawing' && b.isDrawer && !(a.phase === 'impDrawing' && a.isDrawer)) return 'turnStart';
  if (b.phase === 'impVote' && a.phase !== 'impVote') return 'reveal';
  if (b.phase === 'impVote' && b.imp!.myVote !== null && b.imp!.myVote !== a.imp?.myVote) return 'submit';
  if (b.phase === 'impResult' && a.phase !== 'impResult') return b.imp!.result?.imposterWon ? 'timeUp' : 'found';
  return null;
}
