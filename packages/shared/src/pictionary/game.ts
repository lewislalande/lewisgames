import { connectedPlayers, type Room } from '../room';
import { clampSettings, DEFAULT_SETTINGS, type PictionarySettings } from './settings';
import { drawerPoints, guesserPoints } from './scoring';
import { hintsUnlocked, isLetterIndex } from './hints';
import { classifyGuess } from '../text';
import {
  addAction, appendPoints, emptyHistory, isValidAction, MAX_STROKE_POINTS, redo, undo,
  type DrawAction, type DrawingHistory, type Point,
} from './drawing';

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'turnEnd' | 'gameOver';
export type ChatEntry = { id: number; kind: 'guess' | 'system'; playerId?: string; text: string };
export type PictionaryState = {
  phase: Phase;
  settings: PictionarySettings;
  turnOrder: string[];
  turnIndex: number;
  /** 1-based */
  round: number;
  drawerId: string | null;
  wordChoices: string[];
  word: string | null;
  phaseEndsAt: number | null;
  drawStartedAt: number | null;
  found: { playerId: string; at: number }[];
  revealed: number[];
  scores: Record<string, number>;
  turnPoints: Record<string, number>;
  history: DrawingHistory;
  chat: ChatEntry[];
  nextChatId: number;
  usedWords: string[];
};

export type DrawOp =
  | { op: 'add'; action: DrawAction }
  | { op: 'append'; id: string; points: Point[] }
  | { op: 'undo' }
  | { op: 'redo' };

export type GameEvent =
  | { type: 'setSettings'; by: string; settings: unknown }
  | { type: 'start'; by: string }
  | { type: 'chooseWord'; by: string; index: number }
  | { type: 'guess'; by: string; text: string }
  | { type: 'revealLetter'; by: string; index: number }
  | { type: 'draw'; by: string; op: DrawOp }
  | { type: 'timeout' }
  | { type: 'playerJoined'; playerId: string }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'restart'; by: string };

export type Effect =
  | { type: 'state' }
  | { type: 'draw'; op: DrawOp }
  | { type: 'private'; to: string; notice: 'close' | 'correct' };

export type Ctx = { now: number; rng: () => number; room: Room; words: string[] };
export type Result = { state: PictionaryState; effects: Effect[] };

export const TURN_END_MS = 5000;

export function initialState(settings: PictionarySettings = DEFAULT_SETTINGS): PictionaryState {
  return {
    phase: 'lobby',
    settings,
    turnOrder: [],
    turnIndex: 0,
    round: 1,
    drawerId: null,
    wordChoices: [],
    word: null,
    phaseEndsAt: null,
    drawStartedAt: null,
    found: [],
    revealed: [],
    scores: {},
    turnPoints: {},
    history: emptyHistory(),
    chat: [],
    nextChatId: 1,
    usedWords: [],
  };
}

const changed = (state: PictionaryState): Result => ({ state, effects: [{ type: 'state' }] });
const unchanged = (state: PictionaryState): Result => ({ state, effects: [] });

const isConnected = (room: Room, id: string): boolean =>
  room.players.some((p) => p.id === id && p.connected);

const MAX_CHAT = 100;
const MAX_GUESS_LENGTH = 100;
const MAX_APPEND_POINTS = 200;

const addChat = (s: PictionaryState, entry: Omit<ChatEntry, 'id'>): PictionaryState => ({
  ...s,
  chat: [...s.chat, { id: s.nextChatId, ...entry }].slice(-MAX_CHAT),
  nextChatId: s.nextChatId + 1,
});

const addSystemChat = (s: PictionaryState, text: string): PictionaryState =>
  addChat(s, { kind: 'system', text });

const playerName = (room: Room, id: string): string => room.players.find((p) => p.id === id)?.name ?? id;

/** Every connected player except the drawer has found the word (and there is at least one). */
function allFound(s: PictionaryState, ctx: Ctx): boolean {
  const guessers = connectedPlayers(ctx.room).filter((p) => p.id !== s.drawerId);
  return guessers.length > 0 && guessers.every((p) => s.found.some((f) => f.playerId === p.id));
}

/** Pick `count` distinct words at random (partial Fisher-Yates). */
function sample(pool: string[], count: number, rng: () => number): string[] {
  const a = [...pool];
  const n = Math.min(count, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.min(a.length - i - 1, Math.floor(rng() * (a.length - i)));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

/** Choices for the next turn; resets `usedWords` when the pool is exhausted. */
function pickChoices(s: PictionaryState, ctx: Ctx): { choices: string[]; usedWords: string[] } {
  const { customWords, customWordsMode, wordChoices } = s.settings;
  const base =
    customWordsMode === 'only' && customWords.length >= wordChoices
      ? customWords
      : customWordsMode === 'only'
        ? ctx.words
        : [...ctx.words, ...customWords];
  const pool = [...new Set(base)];
  let usedWords = s.usedWords;
  let available = pool.filter((w) => !usedWords.includes(w));
  if (available.length < wordChoices) {
    usedWords = [];
    available = pool;
  }
  return { choices: sample(available, wordChoices, ctx.rng), usedWords };
}

function gameOver(s: PictionaryState): Result {
  return changed({
    ...s,
    phase: 'gameOver',
    drawerId: null,
    wordChoices: [],
    word: null,
    phaseEndsAt: null,
    drawStartedAt: null,
  });
}

/** Start the turn at the first connected drawer found from `fromIndex` (wrapping rounds), or end the game. */
function advance(s: PictionaryState, fromIndex: number, ctx: Ctx): Result {
  let index = fromIndex;
  let round = s.round;
  for (let i = 0; i < s.turnOrder.length; i++) {
    if (index >= s.turnOrder.length) {
      index = 0;
      round += 1;
    }
    if (round > s.settings.rounds) break;
    if (isConnected(ctx.room, s.turnOrder[index]!)) return beginTurn({ ...s, turnIndex: index, round }, ctx);
    index += 1;
  }
  return gameOver({ ...s, round: Math.min(round, s.settings.rounds) });
}

function beginTurn(s: PictionaryState, ctx: Ctx): Result {
  const { choices, usedWords } = pickChoices(s, ctx);
  return changed({
    ...s,
    phase: 'choosing',
    drawerId: s.turnOrder[s.turnIndex]!,
    wordChoices: choices,
    word: null,
    usedWords,
    phaseEndsAt: ctx.now + s.settings.chooseSeconds * 1000,
    drawStartedAt: null,
    history: emptyHistory(),
    found: [],
    revealed: [],
    turnPoints: {},
  });
}

function startDrawing(s: PictionaryState, index: number, ctx: Ctx): Result {
  const word = s.wordChoices[index]!;
  return changed({
    ...s,
    phase: 'drawing',
    word,
    usedWords: [...s.usedWords, word],
    wordChoices: [],
    drawStartedAt: ctx.now,
    phaseEndsAt: ctx.now + s.settings.drawSeconds * 1000,
  });
}

function endTurn(s: PictionaryState, ctx: Ctx): Result {
  const drawer = s.drawerId!;
  const guessers = connectedPlayers(ctx.room).filter((p) => p.id !== drawer).length;
  const pts = drawerPoints(s.found.length, guessers);
  let next: PictionaryState = {
    ...s,
    phase: 'turnEnd',
    wordChoices: [],
    scores: { ...s.scores, [drawer]: (s.scores[drawer] ?? 0) + pts },
    turnPoints: { ...s.turnPoints, [drawer]: (s.turnPoints[drawer] ?? 0) + pts },
    phaseEndsAt: ctx.now + TURN_END_MS,
  };
  if (s.word) next = addSystemChat(next, `« Le mot était : ${s.word} »`);
  return changed(next);
}

function start(s: PictionaryState, ctx: Ctx): Result {
  const order = [...connectedPlayers(ctx.room)].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.id);
  const fresh: PictionaryState = {
    ...initialState(s.settings),
    turnOrder: order,
    scores: Object.fromEntries(order.map((id) => [id, 0])),
  };
  return advance(fresh, 0, ctx);
}

function onTimeout(s: PictionaryState, ctx: Ctx): Result {
  if (s.phaseEndsAt === null || ctx.now < s.phaseEndsAt) return unchanged(s);
  switch (s.phase) {
    case 'choosing':
      return startDrawing(s, Math.min(s.wordChoices.length - 1, Math.floor(ctx.rng() * s.wordChoices.length)), ctx);
    case 'drawing':
      return endTurn(s, ctx);
    case 'turnEnd':
      return advance(s, s.turnIndex + 1, ctx);
    default:
      return unchanged(s);
  }
}

function onPlayerJoined(s: PictionaryState, playerId: string): Result {
  if (s.phase === 'lobby' || s.phase === 'gameOver' || s.turnOrder.includes(playerId)) return changed(s);
  return changed({
    ...s,
    turnOrder: [...s.turnOrder, playerId],
    scores: { ...s.scores, [playerId]: s.scores[playerId] ?? 0 },
  });
}

function onPlayerLeft(s: PictionaryState, playerId: string, ctx: Ctx): Result {
  if (s.phase === 'lobby' || s.phase === 'gameOver') return changed(s);
  if (connectedPlayers(ctx.room).length < 2) return gameOver(s);
  if ((s.phase === 'choosing' || s.phase === 'drawing') && playerId === s.drawerId) return endTurn(s, ctx);
  if (s.phase === 'drawing' && allFound(s, ctx)) return endTurn(s, ctx);
  return changed(s);
}

function onGuess(s: PictionaryState, by: string, text: unknown, ctx: Ctx): Result {
  if (s.phase !== 'drawing' || s.word === null || typeof text !== 'string') return unchanged(s);
  if (by === s.drawerId || !isConnected(ctx.room, by) || s.found.some((f) => f.playerId === by)) {
    return unchanged(s);
  }
  const guess = text.trim();
  if (guess.length < 1 || guess.length > MAX_GUESS_LENGTH) return unchanged(s);
  const verdict = classifyGuess(guess, s.word, s.settings.closeDetection);
  if (verdict === 'close') return { state: s, effects: [{ type: 'private', to: by, notice: 'close' }] };
  if (verdict === 'wrong') return changed(addChat(s, { kind: 'guess', playerId: by, text: guess }));
  const elapsed = ctx.now - (s.drawStartedAt ?? ctx.now);
  const pts = guesserPoints(elapsed, s.settings.drawSeconds * 1000, s.found.length === 0);
  let next: PictionaryState = {
    ...s,
    found: [...s.found, { playerId: by, at: ctx.now }],
    scores: { ...s.scores, [by]: (s.scores[by] ?? 0) + pts },
    turnPoints: { ...s.turnPoints, [by]: (s.turnPoints[by] ?? 0) + pts },
  };
  next = addSystemChat(next, `« ${playerName(ctx.room, by)} a trouvé ! »`);
  const effects: Effect[] = [{ type: 'state' }, { type: 'private', to: by, notice: 'correct' }];
  if (allFound(next, ctx)) return { state: endTurn(next, ctx).state, effects };
  return { state: next, effects };
}

function onRevealLetter(s: PictionaryState, by: string, index: unknown, ctx: Ctx): Result {
  if (s.phase !== 'drawing' || by !== s.drawerId || s.word === null || s.drawStartedAt === null) return unchanged(s);
  if (!Number.isInteger(index) || s.revealed.length >= s.settings.maxHints) return unchanged(s);
  const i = index as number;
  if (!isLetterIndex(s.word, i) || s.revealed.includes(i)) return unchanged(s);
  if (!hintsUnlocked(ctx.now - s.drawStartedAt, s.settings.drawSeconds * 1000, s.settings.hintUnlockPct)) {
    return unchanged(s);
  }
  return changed({ ...s, revealed: [...s.revealed, i] });
}

const isPoint = (p: unknown): p is Point =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Rebuild a validated action from known fields only. */
function sanitizeAction(a: DrawAction): DrawAction {
  const pt = (p: Point): Point => [p[0], p[1]];
  switch (a.kind) {
    case 'clear':
      return { id: a.id, kind: 'clear' };
    case 'fill':
      return { id: a.id, kind: 'fill', color: a.color, opacity: a.opacity, at: pt(a.at) };
    case 'stroke':
      return {
        id: a.id, kind: 'stroke', tool: a.tool, color: a.color, size: a.size,
        opacity: a.opacity, points: a.points.map(pt),
      };
    default:
      return {
        id: a.id, kind: a.kind, color: a.color, size: a.size, opacity: a.opacity,
        filled: a.filled, from: pt(a.from), to: pt(a.to),
      };
  }
}

function onDraw(s: PictionaryState, by: string, op: DrawOp | undefined): Result {
  if (s.phase !== 'drawing' || by !== s.drawerId || typeof op !== 'object' || op === null) return unchanged(s);
  const withHistory = (history: DrawingHistory, sent: DrawOp): Result =>
    history === s.history ? unchanged(s) : { state: { ...s, history }, effects: [{ type: 'draw', op: sent }] };
  switch (op.op) {
    case 'add': {
      if (!isValidAction(op.action)) return unchanged(s);
      const action = sanitizeAction(op.action);
      return withHistory(addAction(s.history, action), { op: 'add', action });
    }
    case 'append': {
      const last = s.history.actions[s.history.actions.length - 1];
      if (!last || last.kind !== 'stroke' || last.id !== op.id) return unchanged(s);
      if (!Array.isArray(op.points) || op.points.length < 1 || op.points.length > MAX_APPEND_POINTS) {
        return unchanged(s);
      }
      if (!op.points.every(isPoint)) return unchanged(s);
      if (last.points.length + op.points.length > MAX_STROKE_POINTS) return unchanged(s);
      const points = op.points.map((p): Point => [p[0], p[1]]);
      return withHistory(appendPoints(s.history, op.id, points), { op: 'append', id: op.id, points });
    }
    case 'undo':
      return withHistory(undo(s.history), { op: 'undo' });
    case 'redo':
      return withHistory(redo(s.history), { op: 'redo' });
    default:
      return unchanged(s);
  }
}

export function reduce(state: PictionaryState, event: GameEvent, ctx: Ctx): Result {
  const isHost = 'by' in event && event.by === ctx.room.hostId;
  switch (event.type) {
    case 'setSettings':
      if (!isHost || (state.phase !== 'lobby' && state.phase !== 'gameOver')) return unchanged(state);
      return changed({ ...state, settings: clampSettings(event.settings) });
    case 'start':
      if (!isHost || state.phase !== 'lobby' || connectedPlayers(ctx.room).length < 2) return unchanged(state);
      return start(state, ctx);
    case 'restart':
      if (!isHost || state.phase !== 'gameOver') return unchanged(state);
      return changed(initialState(state.settings));
    case 'chooseWord':
      if (state.phase !== 'choosing' || event.by !== state.drawerId) return unchanged(state);
      if (!Number.isInteger(event.index) || event.index < 0 || event.index >= state.wordChoices.length) {
        return unchanged(state);
      }
      return startDrawing(state, event.index, ctx);
    case 'timeout':
      return onTimeout(state, ctx);
    case 'playerJoined':
      return onPlayerJoined(state, event.playerId);
    case 'playerLeft':
      return onPlayerLeft(state, event.playerId, ctx);
    case 'guess':
      return onGuess(state, event.by, event.text, ctx);
    case 'revealLetter':
      return onRevealLetter(state, event.by, event.index, ctx);
    case 'draw':
      return onDraw(state, event.by, event.op);
    default:
      return unchanged(state);
  }
}
