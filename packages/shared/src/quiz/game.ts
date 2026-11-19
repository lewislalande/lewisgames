import { connectedPlayers, type Room } from '../room';
import { clampQuizSettings, DEFAULT_QUIZ_SETTINGS, type QuizSettings } from './settings';
import { groupAnswers, resolveVotes, type AnswerGroup, type VoteValue } from './grouping';

export type Question = { id: number; theme: string; question: string; answer: string; variants: string[] };

export type QuizPhase = 'lobby' | 'answering' | 'revealing' | 'voting' | 'deciding' | 'result' | 'gameOver';

export type QuizState = {
  phase: QuizPhase;
  settings: QuizSettings;
  questions: Question[];
  /** Index into `questions` of the current question. */
  index: number;
  /** Current question's answers, by playerId (trimmed; may be empty). */
  answers: Record<string, string>;
  groups: AnswerGroup[];
  revealedCount: number;
  answerShown: boolean;
  /** groupId → voterId → vote */
  votes: Record<string, Record<string, VoteValue>>;
  /** groupId → resolved value (tied groups are missing until the host decides) */
  outcomes: Record<string, VoteValue>;
  /** Connected players who still have a group to vote on (voting only); kept here since views do not see the room. */
  pendingVoters: string[];
  questionPoints: Record<string, number>;
  scores: Record<string, number>;
  phaseEndsAt: number | null;
};

export type QuizEvent =
  | { type: 'setSettings'; by: string; settings: unknown }
  | { type: 'start'; by: string; questions: Question[] }
  | { type: 'answer'; by: string; text: string }
  | { type: 'next'; by: string }
  | { type: 'vote'; by: string; groupId: string; vote: VoteValue }
  | { type: 'closeVote'; by: string }
  | { type: 'decide'; by: string; groupId: string; vote: VoteValue }
  | { type: 'timeout' }
  | { type: 'playerJoined'; playerId: string }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'restart'; by: string };

export type QuizEffect = { type: 'state' };
export type QuizCtx = { now: number; room: Room };
type Result = { state: QuizState; effects: QuizEffect[] };

const MAX_ANSWER_LENGTH = 100;
const POINTS: Record<VoteValue, number> = { yes: 1, half: 0.5, no: 0 };

export function quizInitialState(settings: QuizSettings = DEFAULT_QUIZ_SETTINGS): QuizState {
  return {
    phase: 'lobby',
    settings,
    questions: [],
    index: 0,
    answers: {},
    groups: [],
    revealedCount: 0,
    answerShown: false,
    votes: {},
    outcomes: {},
    pendingVoters: [],
    questionPoints: {},
    scores: {},
    phaseEndsAt: null,
  };
}

const changed = (state: QuizState): Result => ({ state, effects: [{ type: 'state' }] });
const unchanged = (state: QuizState): Result => ({ state, effects: [] });

const isVoteValue = (v: unknown): v is VoteValue => v === 'yes' || v === 'half' || v === 'no';
const connectedIds = (ctx: QuizCtx): string[] => connectedPlayers(ctx.room).map((p) => p.id);
const isConnected = (ctx: QuizCtx, id: string): boolean => connectedIds(ctx).includes(id);

// ---- answering ----

function beginQuestion(s: QuizState, index: number, ctx: QuizCtx): Result {
  return changed({
    ...s,
    phase: 'answering',
    index,
    answers: {},
    groups: [],
    revealedCount: 0,
    answerShown: false,
    votes: {},
    outcomes: {},
    pendingVoters: [],
    questionPoints: {},
    phaseEndsAt: ctx.now + s.settings.answerSeconds * 1000,
  });
}

function start(s: QuizState, questions: Question[], ctx: QuizCtx): Result {
  const ids = connectedIds(ctx);
  const fresh: QuizState = {
    ...quizInitialState(s.settings),
    questions: questions.slice(0, Math.min(s.settings.questionCount, questions.length)),
    scores: Object.fromEntries(ids.map((id) => [id, 0])),
  };
  return beginQuestion(fresh, 0, ctx);
}

const everyoneAnswered = (s: QuizState, ctx: QuizCtx): boolean => {
  const ids = connectedIds(ctx);
  return ids.length > 0 && ids.every((id) => (s.answers[id] ?? '') !== '');
};

function endAnswering(s: QuizState, ctx: QuizCtx): Result {
  return changed({
    ...s,
    phase: 'revealing',
    groups: groupAnswers(s.answers, ctx.room.players.map((p) => p.id)),
    revealedCount: 0,
    answerShown: false,
    phaseEndsAt: null,
  });
}

function onAnswer(s: QuizState, by: string, text: unknown, ctx: QuizCtx): Result {
  if (s.phase !== 'answering' || typeof text !== 'string' || !isConnected(ctx, by)) return unchanged(s);
  const clean = text.trim();
  if (clean.length > MAX_ANSWER_LENGTH || s.answers[by] === clean) return unchanged(s);
  const next = { ...s, answers: { ...s.answers, [by]: clean } };
  return everyoneAnswered(next, ctx) ? endAnswering(next, ctx) : changed(next);
}

// ---- revealing ----

function onRevealNext(s: QuizState, ctx: QuizCtx): Result {
  if (s.revealedCount < s.groups.length) return changed({ ...s, revealedCount: s.revealedCount + 1 });
  if (!s.answerShown) return changed({ ...s, answerShown: true });
  if (s.groups.length === 0) return enterResult(s, ctx);
  return checkVotingDone({ ...s, phase: 'voting', votes: {}, outcomes: {} }, ctx);
}

// ---- voting ----

/** Connected players lacking a vote on a group they did not author. */
function pendingVotersOf(s: QuizState, ctx: QuizCtx): string[] {
  return connectedIds(ctx).filter((id) =>
    s.groups.some((g) => !g.authors.includes(id) && s.votes[g.id]?.[id] === undefined),
  );
}

/** Ends the vote once nobody connected is still pending; otherwise refreshes `pendingVoters`. */
function checkVotingDone(s: QuizState, ctx: QuizCtx): Result {
  const pendingVoters = pendingVotersOf(s, ctx);
  if (pendingVoters.length === 0) return closeVoting(s, ctx);
  return changed({ ...s, pendingVoters });
}

/**
 * Resolves each group on the votes cast (including by players who left since). A tie — including a
 * group nobody voted on — is ½ when the host is an author, otherwise left for the host to decide.
 */
function closeVoting(s: QuizState, ctx: QuizCtx): Result {
  const outcomes: Record<string, VoteValue> = {};
  for (const g of s.groups) {
    const v = resolveVotes(Object.values(s.votes[g.id] ?? {}));
    if (v !== 'tie') outcomes[g.id] = v;
    else if (ctx.room.hostId !== null && g.authors.includes(ctx.room.hostId)) outcomes[g.id] = 'half';
  }
  const next: QuizState = { ...s, outcomes, pendingVoters: [] };
  if (s.groups.every((g) => outcomes[g.id] !== undefined)) return enterResult(next, ctx);
  return changed({ ...next, phase: 'deciding' });
}

function onVote(s: QuizState, by: string, groupId: unknown, vote: unknown, ctx: QuizCtx): Result {
  if (s.phase !== 'voting' || !isVoteValue(vote) || !isConnected(ctx, by)) return unchanged(s);
  const group = s.groups.find((g) => g.id === groupId);
  if (!group || group.authors.includes(by) || s.votes[group.id]?.[by] === vote) return unchanged(s);
  const votes = { ...s.votes, [group.id]: { ...s.votes[group.id], [by]: vote } };
  return checkVotingDone({ ...s, votes }, ctx);
}

// ---- deciding / result ----

function onDecide(s: QuizState, groupId: unknown, vote: unknown, ctx: QuizCtx): Result {
  if (s.phase !== 'deciding' || !isVoteValue(vote)) return unchanged(s);
  const group = s.groups.find((g) => g.id === groupId);
  if (!group || s.outcomes[group.id] !== undefined) return unchanged(s);
  const next = { ...s, outcomes: { ...s.outcomes, [group.id]: vote } };
  if (s.groups.every((g) => next.outcomes[g.id] !== undefined)) return enterResult(next, ctx);
  return changed(next);
}

function enterResult(s: QuizState, ctx: QuizCtx): Result {
  const questionPoints: Record<string, number> = Object.fromEntries(connectedIds(ctx).map((id) => [id, 0]));
  for (const g of s.groups) {
    const pts = POINTS[s.outcomes[g.id] ?? 'no'];
    for (const a of g.authors) questionPoints[a] = (questionPoints[a] ?? 0) + pts;
  }
  const scores = { ...s.scores };
  for (const [id, pts] of Object.entries(questionPoints)) scores[id] = (scores[id] ?? 0) + pts;
  return changed({ ...s, phase: 'result', questionPoints, scores, pendingVoters: [], phaseEndsAt: null });
}

function onResultNext(s: QuizState, ctx: QuizCtx): Result {
  if (s.index + 1 < s.questions.length) return beginQuestion(s, s.index + 1, ctx);
  return changed({ ...s, phase: 'gameOver', phaseEndsAt: null });
}

// ---- events ----

function onNext(s: QuizState, ctx: QuizCtx): Result {
  switch (s.phase) {
    case 'revealing':
      return onRevealNext(s, ctx);
    case 'result':
      return onResultNext(s, ctx);
    default:
      return unchanged(s);
  }
}

function onTimeout(s: QuizState, ctx: QuizCtx): Result {
  if (s.phase !== 'answering' || s.phaseEndsAt === null || ctx.now < s.phaseEndsAt) return unchanged(s);
  return endAnswering(s, ctx);
}

function onPlayerJoined(s: QuizState, playerId: string, ctx: QuizCtx): Result {
  if (s.phase === 'lobby' || s.phase === 'gameOver') return unchanged(s);
  let next = s.scores[playerId] === undefined ? { ...s, scores: { ...s.scores, [playerId]: 0 } } : s;
  if (next.phase === 'voting') {
    const pendingVoters = pendingVotersOf(next, ctx);
    if (pendingVoters.join() !== next.pendingVoters.join()) next = { ...next, pendingVoters };
  }
  return next === s ? unchanged(s) : changed(next);
}

function onPlayerLeft(s: QuizState, ctx: QuizCtx): Result {
  if (s.phase === 'answering' && everyoneAnswered(s, ctx)) return endAnswering(s, ctx);
  if (s.phase === 'voting') {
    const pendingVoters = pendingVotersOf(s, ctx);
    if (pendingVoters.join() === s.pendingVoters.join()) return unchanged(s);
    return checkVotingDone(s, ctx);
  }
  return unchanged(s);
}

export function quizReduce(state: QuizState, event: QuizEvent, ctx: QuizCtx): Result {
  const isHost = 'by' in event && ctx.room.hostId !== null && event.by === ctx.room.hostId;
  switch (event.type) {
    case 'setSettings':
      if (!isHost || (state.phase !== 'lobby' && state.phase !== 'gameOver')) return unchanged(state);
      return changed({ ...state, settings: clampQuizSettings(event.settings) });
    case 'start':
      if (!isHost || state.phase !== 'lobby' || connectedPlayers(ctx.room).length < 2) return unchanged(state);
      if (!Array.isArray(event.questions) || event.questions.length < 1) return unchanged(state);
      return start(state, event.questions, ctx);
    case 'restart':
      if (!isHost || state.phase !== 'gameOver') return unchanged(state);
      return changed(quizInitialState(state.settings));
    case 'next':
      return isHost ? onNext(state, ctx) : unchanged(state);
    case 'closeVote':
      return isHost && state.phase === 'voting' ? closeVoting(state, ctx) : unchanged(state);
    case 'decide':
      return isHost ? onDecide(state, event.groupId, event.vote, ctx) : unchanged(state);
    case 'answer':
      return onAnswer(state, event.by, event.text, ctx);
    case 'vote':
      return onVote(state, event.by, event.groupId, event.vote, ctx);
    case 'timeout':
      return onTimeout(state, ctx);
    case 'playerJoined':
      return onPlayerJoined(state, event.playerId, ctx);
    case 'playerLeft':
      return onPlayerLeft(state, ctx);
    default:
      return unchanged(state);
  }
}
