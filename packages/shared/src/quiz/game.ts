import { connectedPlayers, type Room } from '../room';
import { clampQuizSettings, DEFAULT_QUIZ_SETTINGS, type QuizSettings } from './settings';
import { groupAnswers, isVoteValue, resolveVotes, type AnswerGroup, type VoteValue } from './grouping';

export type Question = { id: number; theme: string; question: string; answer: string; variants: string[] };

/**
 * Every question is answered in a row (with a short `transition` between two), then each is
 * reviewed in turn: `voting` → (`deciding`) → `result`, the host moving to the next review.
 */
export type QuizPhase = 'lobby' | 'answering' | 'transition' | 'voting' | 'deciding' | 'result' | 'gameOver';

export type QuizState = {
  phase: QuizPhase;
  settings: QuizSettings;
  questions: Question[];
  /** Index into `questions` of the question being answered. */
  index: number;
  /** Current question's answers, by playerId (trimmed; may be empty); emptied once answering ends. */
  answers: Record<string, string>;
  /** playerId → true once the player submitted (Enter / Envoyer); drafts (autosend) are in `answers` only. */
  submitted: Record<string, boolean>;
  /** Per question index: playerId → final answer text (non-blank only), stored when its answering ends. */
  allAnswers: Record<string, string>[];
  /** Index into `questions` of the question under review (voting / deciding / result). */
  reviewIndex: number;
  /** Answering speed (see retime); 1 outside answering. */
  timeRate: number;
  /** The reviewed question's answer groups. */
  groups: AnswerGroup[];
  /** groupId → voterId → vote */
  votes: Record<string, Record<string, VoteValue>>;
  /** groupId → resolved value (tied groups are missing until the host decides) */
  outcomes: Record<string, VoteValue>;
  /** Connected players who still have a group to vote on (voting only); kept here since views do not see the room. */
  pendingVoters: string[];
  /** Players connected when the review opened: only they are awaited (later joiners may still vote). */
  voters: string[];
  /** GroupIds whose authors vote on them (see selfVoteGroupIds); recomputed while voting, frozen once it closes. */
  selfVoteGroups: string[];
  questionPoints: Record<string, number>;
  scores: Record<string, number>;
  phaseEndsAt: number | null;
};

export type QuizEvent =
  | { type: 'setSettings'; by: string; settings: unknown }
  | { type: 'start'; by: string; questions: Question[] }
  | { type: 'answer'; by: string; text: string; final: boolean }
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
/** Pause between two questions. */
export const TRANSITION_MS = 1000;
/** Points an answer's authors get for its outcome. */
export const QUIZ_POINTS: Record<VoteValue, number> = { yes: 1, half: 0.5, no: 0 };

export function quizInitialState(settings: QuizSettings = DEFAULT_QUIZ_SETTINGS): QuizState {
  return {
    phase: 'lobby',
    settings,
    questions: [],
    index: 0,
    answers: {},
    submitted: {},
    allAnswers: [],
    reviewIndex: 0,
    timeRate: 1,
    groups: [],
    votes: {},
    outcomes: {},
    pendingVoters: [],
    voters: [],
    selfVoteGroups: [],
    questionPoints: {},
    scores: {},
    phaseEndsAt: null,
  };
}

const PHASES: readonly string[] = ['lobby', 'answering', 'transition', 'voting', 'deciding', 'result', 'gameOver'];

/**
 * Brings a stored state up to the current format (rooms saved before quiz v2): missing fields
 * get their initial value, and a phase that no longer exists (the old `revealing`) ends the game
 * so the host can restart. A current state comes back equal.
 */
export function normalizeQuizState(stored: QuizState): QuizState {
  const s: QuizState = { ...quizInitialState(stored.settings ?? DEFAULT_QUIZ_SETTINGS), ...stored };
  // An unknown phase (the old `revealing`) or a game under way whose per-question answers were not
  // stored (no `allAnswers`) cannot continue: end it so the host can restart.
  const lost = stored.allAnswers === undefined && s.phase !== 'lobby' && s.phase !== 'gameOver';
  return PHASES.includes(s.phase) && !lost ? s : { ...s, phase: 'gameOver', phaseEndsAt: null };
}

const changed = (state: QuizState): Result => ({ state, effects: [{ type: 'state' }] });
const unchanged = (state: QuizState): Result => ({ state, effects: [] });

/** An answer with no letter or digit (blank, or punctuation only) counts as no answer. */
export const isBlankAnswer = (text: string | undefined): boolean => !/[\p{L}\p{N}]/u.test(text ?? '');

const connectedIds = (ctx: QuizCtx): string[] => connectedPlayers(ctx.room).map((p) => p.id);
const isConnected = (ctx: QuizCtx, id: string): boolean => connectedIds(ctx).includes(id);

// ---- answering ----

function beginQuestion(s: QuizState, index: number, ctx: QuizCtx): Result {
  return changed({
    ...s,
    phase: 'answering',
    index,
    answers: {},
    submitted: {},
    timeRate: 1,
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

/** Only submitted answers count (drafts do not end the phase); every connected player must have submitted. */
const everyoneAnswered = (s: QuizState, ctx: QuizCtx): boolean => {
  const ids = connectedIds(ctx);
  return ids.length > 0 && ids.every((id) => s.submitted[id] === true && !isBlankAnswer(s.answers[id]));
};

/** Stores the answers (drafts included, blanks dropped), then pauses before the next question or starts the review. */
function endAnswering(s: QuizState, ctx: QuizCtx): Result {
  const meaningful = Object.fromEntries(Object.entries(s.answers).filter(([, text]) => !isBlankAnswer(text)));
  const allAnswers = [...s.allAnswers];
  allAnswers[s.index] = meaningful;
  const next: QuizState = { ...s, allAnswers, answers: {}, submitted: {}, timeRate: 1, phaseEndsAt: null };
  if (s.index + 1 < s.questions.length) {
    return changed({ ...next, phase: 'transition', phaseEndsAt: ctx.now + TRANSITION_MS });
  }
  return enterReview(next, 0, ctx);
}

/**
 * Speeds the answering timer up as players submit: rate = 1 + 2 × submitted / connected, never
 * lower than before within the question (kept as is with nobody connected). The remaining time is
 * rescaled so that the virtual time left, (phaseEndsAt − now) × rate, is unchanged.
 */
function retime(s: QuizState, ctx: QuizCtx): QuizState {
  if (s.phase !== 'answering' || s.phaseEndsAt === null) return s;
  const ids = connectedIds(ctx);
  if (ids.length === 0) return s;
  const submitted = ids.filter((id) => s.submitted[id] === true).length;
  const rate = Math.max(s.timeRate, 1 + (2 * submitted) / ids.length);
  if (rate === s.timeRate) return s;
  const remainingVirtual = Math.max(0, s.phaseEndsAt - ctx.now) * s.timeRate;
  return { ...s, timeRate: rate, phaseEndsAt: ctx.now + remainingVirtual / rate };
}

function onAnswer(s: QuizState, by: string, text: unknown, final: unknown, ctx: QuizCtx): Result {
  if (s.phase !== 'answering' || typeof text !== 'string' || !isConnected(ctx, by)) return unchanged(s);
  const clean = text.trim();
  if (clean.length > MAX_ANSWER_LENGTH) return unchanged(s);
  const submitted = final === true && !isBlankAnswer(clean);
  if (s.answers[by] === clean && (s.submitted[by] === true) === submitted) return unchanged(s);
  const next = { ...s, answers: { ...s.answers, [by]: clean }, submitted: { ...s.submitted, [by]: submitted } };
  return everyoneAnswered(next, ctx) ? endAnswering(next, ctx) : changed(retime(next, ctx));
}

// ---- review ----

/**
 * Opens the review of question `reviewIndex`: its answers are grouped and voted on by the players
 * connected now; with no answer at all it goes straight to the result.
 */
function enterReview(s: QuizState, reviewIndex: number, ctx: QuizCtx): Result {
  const groups = groupAnswers(s.allAnswers[reviewIndex] ?? {}, ctx.room.players.map((p) => p.id));
  const next: QuizState = {
    ...s,
    phase: 'voting',
    reviewIndex,
    groups,
    votes: {},
    outcomes: {},
    pendingVoters: [],
    voters: connectedIds(ctx),
    selfVoteGroups: [],
    questionPoints: {},
    timeRate: 1,
    phaseEndsAt: null,
  };
  return groups.length === 0 ? enterResult(next, ctx) : checkVotingDone(next, ctx);
}

// ---- voting ----

/**
 * A group with nobody left to judge it (every player present at the start of the vote and still
 * connected authored it, e.g. everybody gave the same answer): its authors vote on it, exception
 * to the no-self-vote rule.
 */
function selfVoteGroupIds(s: QuizState, ctx: QuizCtx): string[] {
  const present = connectedIds(ctx).filter((id) => s.voters.includes(id));
  return s.groups.filter((g) => present.length > 0 && present.every((id) => g.authors.includes(id))).map((g) => g.id);
}

const canVoteOn = (s: QuizState, g: AnswerGroup, id: string): boolean =>
  !g.authors.includes(id) || s.selfVoteGroups.includes(g.id);

/** Connected players present at the start of the vote lacking a vote on a group they may vote on. */
function pendingVotersOf(s: QuizState, ctx: QuizCtx): string[] {
  return connectedIds(ctx).filter((id) =>
    s.voters.includes(id) && s.groups.some((g) => canVoteOn(s, g, id) && s.votes[g.id]?.[id] === undefined),
  );
}

/** Ends the vote once nobody connected is still pending; otherwise refreshes `pendingVoters`. */
function checkVotingDone(s0: QuizState, ctx: QuizCtx): Result {
  const s = { ...s0, selfVoteGroups: selfVoteGroupIds(s0, ctx) };
  const pendingVoters = pendingVotersOf(s, ctx);
  if (pendingVoters.length === 0) return closeVoting(s, ctx);
  return changed({ ...s, pendingVoters });
}

/**
 * Resolves each group on the votes cast (including by players who left since). A tie — including a
 * group nobody voted on — goes to `deciding`, where host-authored ties become ½ (see resolveHostTies).
 */
function closeVoting(s0: QuizState, ctx: QuizCtx): Result {
  const s = { ...s0, selfVoteGroups: selfVoteGroupIds(s0, ctx) };
  const outcomes: Record<string, VoteValue> = {};
  for (const g of s.groups) {
    const v = resolveVotes(Object.values(s.votes[g.id] ?? {}));
    if (v !== 'tie') outcomes[g.id] = v;
  }
  return changed(resolveHostTies({ ...s, phase: 'deciding', outcomes, pendingVoters: [] }, ctx));
}

/**
 * In `deciding`: a tie the current host authored resolves to ½ (the host can't judge their own
 * answer; not for a self-vote group, where the host decides), re-checked whenever the host may have changed; with no ties left the question ends.
 */
function resolveHostTies(s: QuizState, ctx: QuizCtx): QuizState {
  if (s.phase !== 'deciding') return s;
  const host = ctx.room.hostId;
  let outcomes = s.outcomes;
  for (const g of s.groups) {
    if (outcomes[g.id] === undefined && host !== null && g.authors.includes(host) && !s.selfVoteGroups.includes(g.id)) {
      outcomes = { ...outcomes, [g.id]: 'half' };
    }
  }
  const next = outcomes === s.outcomes ? s : { ...s, outcomes };
  return s.groups.every((g) => next.outcomes[g.id] !== undefined) ? enterResult(next, ctx).state : next;
}

function onVote(s: QuizState, by: string, groupId: unknown, vote: unknown, ctx: QuizCtx): Result {
  if (s.phase !== 'voting' || !isVoteValue(vote) || !isConnected(ctx, by)) return unchanged(s);
  const group = s.groups.find((g) => g.id === groupId);
  if (!group || !canVoteOn(s, group, by) || s.votes[group.id]?.[by] === vote) return unchanged(s);
  const votes = { ...s.votes, [group.id]: { ...s.votes[group.id], [by]: vote } };
  return checkVotingDone({ ...s, votes }, ctx);
}

// ---- deciding / result ----

function onDecide(s: QuizState, groupId: unknown, vote: unknown, ctx: QuizCtx): Result {
  if (s.phase !== 'deciding' || !isVoteValue(vote)) return unchanged(s);
  const group = s.groups.find((g) => g.id === groupId);
  if (!group || s.outcomes[group.id] !== undefined) return unchanged(s);
  return changed({ ...s, outcomes: { ...s.outcomes, [group.id]: vote } });
}

function enterResult(s: QuizState, ctx: QuizCtx): Result {
  const questionPoints: Record<string, number> = Object.fromEntries(connectedIds(ctx).map((id) => [id, 0]));
  for (const g of s.groups) {
    const pts = QUIZ_POINTS[s.outcomes[g.id] ?? 'no'];
    for (const a of g.authors) questionPoints[a] = (questionPoints[a] ?? 0) + pts;
  }
  const scores = { ...s.scores };
  for (const [id, pts] of Object.entries(questionPoints)) scores[id] = (scores[id] ?? 0) + pts;
  return changed({ ...s, phase: 'result', questionPoints, scores, pendingVoters: [], phaseEndsAt: null });
}

// ---- events ----

/** The host moves on from a review result (the only phase `next` applies to). */
function onNext(s: QuizState, ctx: QuizCtx): Result {
  if (s.phase !== 'result') return unchanged(s);
  if (s.reviewIndex + 1 < s.questions.length) return enterReview(s, s.reviewIndex + 1, ctx);
  return changed({ ...s, phase: 'gameOver', phaseEndsAt: null });
}

function onTimeout(s: QuizState, ctx: QuizCtx): Result {
  if (s.phaseEndsAt === null || ctx.now < s.phaseEndsAt) return unchanged(s);
  if (s.phase === 'answering') return endAnswering(s, ctx);
  if (s.phase === 'transition') return beginQuestion(s, s.index + 1, ctx);
  return unchanged(s);
}

/** Join/leave always report a change: the player list the clients show has changed. */
function onPlayerJoined(s: QuizState, playerId: string, ctx: QuizCtx): Result {
  if (s.phase === 'lobby' || s.phase === 'gameOver') return changed(s);
  const next = s.scores[playerId] === undefined ? { ...s, scores: { ...s.scores, [playerId]: 0 } } : s;
  return next.phase === 'voting' ? checkVotingDone(next, ctx) : changed(retime(next, ctx));
}

function onPlayerLeft(s: QuizState, ctx: QuizCtx): Result {
  // Answering: a leaver may just be refreshing, so only submissions or the timer end the phase.
  if (s.phase === 'voting') return checkVotingDone(s, ctx);
  return changed(retime(s, ctx));
}

export function quizReduce(state: QuizState, event: QuizEvent, ctx: QuizCtx): Result {
  const r = reduceEvent(state, event, ctx);
  // The host may have changed since the vote closed: re-apply the host-author ½ rule.
  const resolved = resolveHostTies(r.state, ctx);
  return resolved === r.state ? r : changed(resolved);
}

/** Merges a partial settings payload over the current settings before clamping. */
function mergeSettings(current: QuizSettings, input: unknown): QuizSettings {
  return clampQuizSettings(input && typeof input === 'object' ? { ...current, ...input } : current);
}

function reduceEvent(state: QuizState, event: QuizEvent, ctx: QuizCtx): Result {
  const isHost = 'by' in event && ctx.room.hostId !== null && event.by === ctx.room.hostId;
  switch (event.type) {
    case 'setSettings':
      if (!isHost || (state.phase !== 'lobby' && state.phase !== 'gameOver')) return unchanged(state);
      return changed({ ...state, settings: mergeSettings(state.settings, event.settings) });
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
      return onAnswer(state, event.by, event.text, event.final, ctx);
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
