import { connectedPlayers } from '../room';
import { classifyGuess } from '../text';
import {
  addAction, appendPoints, emptyHistory, isValidAction, MAX_STROKE_POINTS,
  type DrawAction, type DrawingHistory, type Point,
} from './drawing';
import type { Ctx, DrawOp, GameEvent, Phase, PictionaryState, Result } from './game';
import { changed, gameOver, isConnected, isPoint, unchanged } from './results';

/**
 * Imposter mode ("L'imposteur"): every player but one knows a secret word; each draws one stroke
 * per turn, then the table votes for the imposter, who may still win by guessing the word.
 */

export type ImposterState = {
  /** 1-based */
  manche: number;
  category: string;
  word: string;
  imposterId: string;
  /** Turn order for this manche (random). */
  order: string[];
  /** playerId → hex colour */
  colors: Record<string, string>;
  /** Index into order × impTableRounds. */
  turn: number;
  /** Id of the current turn's stroke once started. */
  strokeId: string | null;
  /** voterId → targetId */
  votes: Record<string, string>;
  accused: string | null;
  guess: string | null;
  imposterWon: boolean | null;
  scribble: DrawAction | null;
};

export type ImposterView = {
  manche: number;
  manches: number;
  category: string;
  isImposter: boolean;
  /** Only players of this manche's order who are not the imposter, until impResult. */
  word: string | null;
  order: string[];
  colors: Record<string, string>;
  currentDrawer: string | null;
  tableRound: number;
  tableRounds: number;
  /** Who has voted (ids only). */
  voted: string[];
  myVote: string | null;
  /** The player the vote designated, during impGuess and impResult. */
  accused: string | null;
  /** impResult only. */
  result: {
    imposterId: string; accused: string | null; guess: string | null; imposterWon: boolean; votes: Record<string, string>;
  } | null;
};

/**
 * category → words. The bundled bank lives in `@kg/shared/server` and reaches the rules through
 * `Ctx.imposterWords`, so it never ships in the web bundle (the imposter could read it there).
 */
export type ImposterWordBank = Readonly<Record<string, readonly string[]>>;

export const IMP_REVEAL_MS = 4000;
export const IMP_VOTE_MS = 30_000;
export const IMP_GUESS_MS = 30_000;
export const IMP_RESULT_MS = 6000;
export const IMP_MIN_PLAYERS = 3;
export const IMP_STROKE_SIZE = 6;
export const SCRIBBLE_COLOR = '#9ca3af';

/** One colour per player, by position in the manche's order. */
export const IMP_PALETTE: readonly string[] = [
  '#dc2626', // red
  '#2563eb', // blue
  '#16a34a', // green
  '#f97316', // orange
  '#7c3aed', // violet
  '#111827', // black
  '#ca8a04', // ochre yellow
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#78350f', // brown
  '#84cc16', // lime
  '#0f766e', // dark teal
];

const IMP_PHASES: ReadonlySet<Phase> = new Set<Phase>(['impReveal', 'impDrawing', 'impDiscuss', 'impVote', 'impGuess', 'impResult']);
export const isImposterPhase = (phase: Phase): boolean => IMP_PHASES.has(phase);

const MAX_GUESS_LENGTH = 100;
const MAX_APPEND_POINTS = 200;

const pick = (n: number, rng: () => number): number => Math.min(n - 1, Math.floor(rng() * n));

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = pick(i + 1, rng);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const pairsOf = (bank: ImposterWordBank): { category: string; word: string }[] =>
  Object.entries(bank).flatMap(([category, words]) => words.map((word) => ({ category, word })));

export const isUsableBank = (bank: ImposterWordBank | undefined): bank is ImposterWordBank =>
  bank !== undefined && pairsOf(bank).length > 0;

/** A random unused word of `bank` (any word once all are used). */
export function pickWordFrom(bank: ImposterWordBank, rng: () => number, used: string[]): { category: string; word: string } {
  const all = pairsOf(bank);
  const usedSet = new Set(used);
  const fresh = all.filter((p) => !usedSet.has(p.word));
  const pool = fresh.length > 0 ? fresh : all;
  return { ...pool[pick(pool.length, rng)]! };
}

/** One smooth random curve (Catmull-Rom through 4 random points), grey, inside the 800×600 canvas. */
export function makeScribble(rng: () => number, id: string): DrawAction {
  const ctrl: Point[] = Array.from({ length: 4 }, () => [120 + rng() * 560, 100 + rng() * 400]);
  const pts = [ctrl[0]!, ...ctrl, ctrl[3]!];
  const STEPS = 12;
  const round = (n: number, max: number) => Math.round(Math.min(max, Math.max(0, n)) * 10) / 10;
  const points: Point[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1]!, pts[i]!, pts[i + 1]!, pts[i + 2]!];
    for (let k = 0; k < STEPS || (i === pts.length - 3 && k === STEPS); k++) {
      const t = k / STEPS;
      const at = (j: 0 | 1) =>
        0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t +
          (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t * t * t);
      points.push([round(at(0), 800), round(at(1), 600)]);
    }
  }
  return { id, kind: 'stroke', tool: 'pen', color: SCRIBBLE_COLOR, size: IMP_STROKE_SIZE, opacity: 1, points };
}

const withImp = (s: PictionaryState, patch: Partial<ImposterState>): PictionaryState => ({ ...s, imp: { ...s.imp!, ...patch } });

const totalTurns = (s: PictionaryState): number => s.imp!.order.length * s.settings.impTableRounds;

/** Starts manche `manche` with the players connected now, or ends the game if there are too few. */
export function beginManche(s: PictionaryState, manche: number, ctx: Ctx): Result {
  const ids = connectedPlayers(ctx.room).map((p) => p.id);
  const bank = ctx.imposterWords;
  if (ids.length < IMP_MIN_PLAYERS || !isUsableBank(bank)) return gameOver(s);
  const order = shuffle(ids, ctx.rng);
  const imposterId = ids[pick(ids.length, ctx.rng)]!;
  const exhausted = pairsOf(bank).every((p) => s.usedWords.includes(p.word));
  const used = exhausted ? [] : s.usedWords;
  const { category, word } = pickWordFrom(bank, ctx.rng, used);
  const scribble = s.settings.impScribble ? makeScribble(ctx.rng, `scribble-${manche}`) : null;
  const history: DrawingHistory = scribble ? addAction(emptyHistory(), scribble) : emptyHistory();
  return changed({
    ...s,
    phase: 'impReveal',
    round: manche,
    drawerId: null,
    word: null,
    wordChoices: [],
    usedWords: [...used, word],
    phaseEndsAt: ctx.now + IMP_REVEAL_MS,
    drawStartedAt: null,
    found: [],
    revealed: [],
    turnPoints: {},
    history,
    imp: {
      manche, category, word, imposterId, order,
      colors: Object.fromEntries(order.map((id, i) => [id, IMP_PALETTE[i % IMP_PALETTE.length]!])),
      turn: 0, strokeId: null, votes: {}, accused: null, guess: null, imposterWon: null, scribble,
    },
  });
}

/** The turn at the first connected drawer from `fromTurn`, or the discussion once every turn is done. */
function startTurn(s: PictionaryState, fromTurn: number, ctx: Ctx): Result {
  const { order } = s.imp!;
  for (let t = fromTurn; t < totalTurns(s); t++) {
    const drawer = order[t % order.length]!;
    if (!isConnected(ctx.room, drawer)) continue;
    return changed({
      ...withImp(s, { turn: t, strokeId: null }),
      phase: 'impDrawing',
      drawerId: drawer,
      phaseEndsAt: ctx.now + s.settings.impStrokeSeconds * 1000,
    });
  }
  return startDiscussion(s, ctx);
}

function startDiscussion(s: PictionaryState, ctx: Ctx): Result {
  const next: PictionaryState = { ...withImp(s, { turn: totalTurns(s), strokeId: null }), drawerId: null };
  if (s.settings.impDiscussSeconds === 0) return startVote(next, ctx);
  return changed({ ...next, phase: 'impDiscuss', phaseEndsAt: ctx.now + s.settings.impDiscussSeconds * 1000 });
}

function startVote(s: PictionaryState, ctx: Ctx): Result {
  return changed({ ...withImp(s, { votes: {} }), phase: 'impVote', phaseEndsAt: ctx.now + IMP_VOTE_MS });
}

/** Every connected player of the manche has voted (and there is at least one). */
function allVoted(s: PictionaryState, ctx: Ctx): boolean {
  const voters = s.imp!.order.filter((id) => isConnected(ctx.room, id));
  return voters.length > 0 && voters.every((id) => id in s.imp!.votes);
}

/** A strict majority on one player accuses them; a tie or no vote lets the imposter escape. */
function resolveVote(s: PictionaryState, ctx: Ctx): Result {
  const { votes, imposterId } = s.imp!;
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) counts.set(target, (counts.get(target) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  const top = [...counts].filter(([, n]) => n === max).map(([id]) => id);
  const accused = max > 0 && top.length === 1 ? top[0]! : null;
  const next = withImp(s, { accused });
  if (accused !== imposterId) return toResult(next, true, ctx);
  return changed({ ...next, phase: 'impGuess', phaseEndsAt: ctx.now + IMP_GUESS_MS });
}

/** Imposter won: +2 to them. Otherwise +1 to every other player of the manche, connected or not. */
function toResult(s: PictionaryState, imposterWon: boolean, ctx: Ctx): Result {
  const { imposterId, order } = s.imp!;
  const points: Record<string, number> = imposterWon
    ? { [imposterId]: 2 }
    : Object.fromEntries(order.filter((id) => id !== imposterId).map((id) => [id, 1]));
  const scores = { ...s.scores };
  for (const [id, n] of Object.entries(points)) scores[id] = (scores[id] ?? 0) + n;
  return changed({
    ...withImp(s, { imposterWon }),
    phase: 'impResult',
    drawerId: null,
    scores,
    turnPoints: points,
    phaseEndsAt: ctx.now + IMP_RESULT_MS,
  });
}

function onTimeout(s: PictionaryState, ctx: Ctx): Result {
  if (s.phaseEndsAt === null || ctx.now < s.phaseEndsAt || !s.imp) return unchanged(s);
  switch (s.phase) {
    case 'impReveal':
      return startTurn(s, 0, ctx);
    case 'impDrawing':
      return startTurn(s, s.imp.turn + 1, ctx);
    case 'impDiscuss':
      return startVote(s, ctx);
    case 'impVote':
      return resolveVote(s, ctx);
    case 'impGuess':
      return toResult(s, false, ctx);
    case 'impResult':
      return s.imp.manche < s.settings.impRounds ? beginManche(s, s.imp.manche + 1, ctx) : gameOver(s);
    default:
      return unchanged(s);
  }
}

function onPlayerLeft(s: PictionaryState, playerId: string, ctx: Ctx): Result {
  if (s.phase === 'impDrawing' && playerId === s.drawerId) return startTurn(s, s.imp!.turn + 1, ctx);
  if (s.phase === 'impVote' && allVoted(s, ctx)) return resolveVote(s, ctx);
  // The unmasked imposter left: their one guess is lost.
  if (s.phase === 'impGuess' && playerId === s.imp!.imposterId) return toResult(s, false, ctx);
  return changed(s);
}

/**
 * The current drawer may start one stroke per turn (pen, their colour, size 6) and extend it;
 * nothing else (no shapes, fills, clears, undo or redo).
 */
function onDraw(s: PictionaryState, by: string, op: DrawOp | undefined): Result {
  if (s.phase !== 'impDrawing' || by !== s.drawerId || typeof op !== 'object' || op === null) return unchanged(s);
  const imp = s.imp!;
  if (op.op === 'add') {
    const a = op.action;
    if (imp.strokeId !== null || !isValidAction(a) || a.kind !== 'stroke' || a.tool !== 'pen') return unchanged(s);
    if (a.color.toLowerCase() !== imp.colors[by] || a.size !== IMP_STROKE_SIZE) return unchanged(s);
    if (s.history.actions.some((x) => x.id === a.id)) return unchanged(s);
    const action: DrawAction = {
      id: a.id, kind: 'stroke', tool: 'pen', color: imp.colors[by]!, size: IMP_STROKE_SIZE, opacity: 1,
      points: a.points.map((p): Point => [p[0], p[1]]),
    };
    return {
      state: { ...withImp(s, { strokeId: action.id }), history: addAction(s.history, action) },
      effects: [{ type: 'draw', op: { op: 'add', action } }],
    };
  }
  if (op.op === 'append') {
    const last = s.history.actions[s.history.actions.length - 1];
    if (imp.strokeId === null || op.id !== imp.strokeId || !last || last.kind !== 'stroke' || last.id !== op.id) {
      return unchanged(s);
    }
    if (!Array.isArray(op.points) || op.points.length < 1 || op.points.length > MAX_APPEND_POINTS) return unchanged(s);
    if (!op.points.every(isPoint) || last.points.length + op.points.length > MAX_STROKE_POINTS) return unchanged(s);
    const points = op.points.map((p): Point => [p[0], p[1]]);
    return {
      state: { ...s, history: appendPoints(s.history, op.id, points) },
      effects: [{ type: 'draw', op: { op: 'append', id: op.id, points } }],
    };
  }
  return unchanged(s);
}

function onVote(s: PictionaryState, by: string, target: unknown, ctx: Ctx): Result {
  if (s.phase !== 'impVote' || typeof target !== 'string') return unchanged(s);
  const { order, votes } = s.imp!;
  if (!order.includes(by) || !order.includes(target) || target === by || votes[by] === target) return unchanged(s);
  const next = withImp(s, { votes: { ...votes, [by]: target } });
  return allVoted(next, ctx) ? resolveVote(next, ctx) : changed(next);
}

function onGuess(s: PictionaryState, by: string, text: unknown, ctx: Ctx): Result {
  if (s.phase !== 'impGuess' || by !== s.imp!.imposterId || s.imp!.guess !== null || typeof text !== 'string') {
    return unchanged(s);
  }
  const guess = text.trim();
  if (guess.length < 1 || guess.length > MAX_GUESS_LENGTH) return unchanged(s);
  const won = classifyGuess(guess, s.imp!.word, false) === 'correct';
  return toResult(withImp(s, { guess }), won, ctx);
}

/** Game events once an imposter game is set up (start, settings, restart and joins are handled by `reduce`). */
export function reduceImposter(s: PictionaryState, event: GameEvent, ctx: Ctx): Result {
  switch (event.type) {
    case 'timeout':
      return onTimeout(s, ctx);
    case 'playerLeft':
      return onPlayerLeft(s, event.playerId, ctx);
    case 'draw':
      return onDraw(s, event.by, event.op);
    case 'impStrokeDone':
      if (s.phase !== 'impDrawing' || event.by !== s.drawerId || s.imp!.strokeId === null) return unchanged(s);
      return startTurn(s, s.imp!.turn + 1, ctx);
    case 'impVote':
      return onVote(s, event.by, event.target, ctx);
    case 'impGuess':
      return onGuess(s, event.by, event.text, ctx);
    case 'impSkip':
      if (s.phase !== 'impDiscuss' || event.by !== ctx.room.hostId) return unchanged(s);
      return startVote(s, ctx);
    default:
      // Chat guesses, word choices and hints do not exist in this mode.
      return unchanged(s);
  }
}

/**
 * Until the result, the word goes only to players of the manche who are not the imposter (a player who
 * joined mid-manche could be the imposter's second session), and votes and the imposter's identity to nobody.
 */
export function imposterViewFor(s: PictionaryState, viewerId: string): ImposterView | null {
  const imp = s.imp ?? null;
  if (!imp || !isImposterPhase(s.phase)) return null;
  const isImposter = viewerId === imp.imposterId;
  const ended = s.phase === 'impResult';
  const len = imp.order.length;
  return {
    manche: imp.manche,
    manches: s.settings.impRounds,
    category: imp.category,
    isImposter,
    word: ended || (!isImposter && imp.order.includes(viewerId)) ? imp.word : null,
    order: imp.order,
    colors: imp.colors,
    currentDrawer: s.phase === 'impDrawing' ? s.drawerId : null,
    tableRound: Math.min(Math.floor(imp.turn / len) + 1, s.settings.impTableRounds),
    tableRounds: s.settings.impTableRounds,
    voted: Object.keys(imp.votes),
    myVote: imp.votes[viewerId] ?? null,
    accused: s.phase === 'impGuess' || ended ? imp.accused : null,
    result: ended
      ? { imposterId: imp.imposterId, accused: imp.accused, guess: imp.guess, imposterWon: imp.imposterWon === true, votes: imp.votes }
      : null,
  };
}
