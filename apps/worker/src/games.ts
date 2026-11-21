import {
  connectedPlayers, DEFAULT_WORDS, initialState, normalizeQuizState, quizInitialState, quizReduce, quizViewFor, reduce, viewFor,
  type ClientMsg, type DrawOp, type ErrorCode, type GameEvent as PictionaryEvent, type GameKind, type PictionaryState,
  type PictionaryView, type QuizEvent, type QuizState, type QuizView, type Room,
} from '@kg/shared';
import { loadWords, markUsed, pickQuestions } from './questions';

/** Every client message but `hello`, which the room handles itself. */
export type GameMsg = Exclude<ClientMsg, { t: 'hello' }>;

/** Events raised by the room itself; every game understands them. */
export type RoomEvent =
  | { type: 'playerJoined'; playerId: string }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'timeout' };

/** What the room must send after an event. */
export type RoomEffect =
  | { type: 'state' }
  | { type: 'draw'; op: DrawOp; except: string | null }
  | { type: 'private'; to: string; notice: 'close' | 'correct' };

export type GameView = { kind: 'pictionary'; game: PictionaryView } | { kind: 'quiz'; game: QuizView };

export type GameCtx = { now: number; room: Room };

/** An event ready to reduce (with what it needed from D1), or a refusal sent to its sender only. */
export type Prepared<S, E> =
  | { ok: true; event: E; commit?: (prev: S, next: S) => Promise<void> }
  | { ok: false; error: ErrorCode };

export type GameAdapter<S, E> = {
  initial(): S;
  maxPlayers(state: S): number;
  phaseEndsAt(state: S): number | null;
  /** The message as an event of this game; null if it does not belong to this game. */
  toEvent(msg: GameMsg, by: string): E | null;
  /** Loads what the event needs before it is reduced; `commit` runs after it was applied. */
  prepare(state: S, event: E, room: Room): Promise<Prepared<S, E>>;
  /** Called when an instance loads a stored game (after a restart), before any event; returns the state to use. */
  resume(state: S): Promise<S>;
  reduce(state: S, event: E | RoomEvent, ctx: GameCtx): { state: S; effects: RoomEffect[] };
  view(state: S, playerId: string, now: number, room: Room): GameView;
  /** Frequent, low-value events whose persistence may be batched. */
  batched(event: E | RoomEvent): boolean;
};

const FALLBACK_WORDS: string[] = [...DEFAULT_WORDS];

const startsGame = (state: { phase: string }, by: string, room: Room): boolean =>
  room.hostId === by && state.phase === 'lobby';

function pictionaryAdapter(db: D1Database): GameAdapter<PictionaryState, PictionaryEvent> {
  /** The D1 word list, loaded at each game start; null until loaded (or if loading failed). */
  let words: string[] | null = null;
  const refreshWords = async (): Promise<void> => {
    try {
      const loaded = await loadWords(db);
      words = loaded.length > 0 ? loaded : FALLBACK_WORDS;
    } catch (err) {
      console.error('loading words failed', err);
    }
  };
  return {
    initial: () => initialState(),
    maxPlayers: (s) => s.settings.maxPlayers,
    phaseEndsAt: (s) => s.phaseEndsAt,
    toEvent(msg, by) {
      switch (msg.t) {
        case 'settings': return { type: 'setSettings', by, settings: msg.settings };
        case 'start': return { type: 'start', by };
        case 'restart': return { type: 'restart', by };
        case 'choose': return { type: 'chooseWord', by, index: msg.index };
        case 'guess': return { type: 'guess', by, text: msg.text };
        case 'reveal': return { type: 'revealLetter', by, index: msg.index };
        case 'draw': return { type: 'draw', by, op: msg.op };
        case 'impDone': return { type: 'impStrokeDone', by };
        case 'impVote': return { type: 'impVote', by, target: msg.target };
        case 'impGuess': return { type: 'impGuess', by, text: msg.text };
        case 'impSkip': return { type: 'impSkip', by };
        default: return null;
      }
    },
    async prepare(state, event, room) {
      if (event.type === 'start' && startsGame(state, event.by, room)) await refreshWords();
      return { ok: true, event };
    },
    async resume(state) {
      if (state.phase !== 'lobby') await refreshWords();
      return state;
    },
    reduce(state, event, ctx) {
      const r = reduce(state, event, { ...ctx, rng: Math.random, words: words ?? FALLBACK_WORDS });
      // Draw ops go to everyone but the drawer (in imposter mode, the current turn's drawer).
      const effects = r.effects.map((e): RoomEffect => (e.type === 'draw' ? { ...e, except: r.state.drawerId } : e));
      return { state: r.state, effects };
    },
    view: (s, playerId, now, room) => ({ kind: 'pictionary', game: viewFor(s, playerId, now, room.ownerId ?? null) }),
    batched: (event) => event.type === 'draw',
  };
}

function quizAdapter(db: D1Database): GameAdapter<QuizState, QuizEvent> {
  return {
    initial: () => quizInitialState(),
    maxPlayers: (s) => s.settings.maxPlayers,
    // The accelerating timer gives fractional end times: never fire before the end.
    phaseEndsAt: (s) => (s.phaseEndsAt === null ? null : Math.ceil(s.phaseEndsAt)),
    toEvent(msg, by) {
      switch (msg.t) {
        case 'settings': return { type: 'setSettings', by, settings: msg.settings };
        // Questions are filled in by prepare().
        case 'start': return { type: 'start', by, questions: [] };
        case 'restart': return { type: 'restart', by };
        case 'answer': return { type: 'answer', by, text: msg.text, final: msg.final };
        case 'next': return { type: 'next', by };
        case 'vote': return { type: 'vote', by, groupId: msg.groupId, vote: msg.vote };
        case 'closeVote': return { type: 'closeVote', by };
        case 'decide': return { type: 'decide', by, groupId: msg.groupId, vote: msg.vote };
        default: return null;
      }
    },
    async prepare(state, event, room) {
      // Only a start the reducer would accept queries D1; anything else it ignores by itself.
      if (event.type !== 'start' || !startsGame(state, event.by, room) || connectedPlayers(room).length < 2) {
        return { ok: true, event };
      }
      let questions;
      try {
        questions = await pickQuestions(db, state.settings.themes, state.settings.questionCount);
      } catch (err) {
        console.error('picking questions failed', err);
        return { ok: false, error: 'internal' };
      }
      if (questions.length === 0) return { ok: false, error: 'no_questions' };
      return {
        ok: true,
        event: { ...event, questions },
        async commit(prev, next) {
          if (prev.phase !== 'lobby' || next.phase === 'lobby') return;
          try {
            await markUsed(db, next.questions.map((q) => q.id), Date.now());
          } catch (err) {
            console.error('marking questions used failed', err);
          }
        },
      };
    },
    // Rooms stored by an older version may lack fields or be in a removed phase.
    resume: async (state) => normalizeQuizState(state),
    reduce: (state, event, ctx) => quizReduce(state, event, ctx),
    view: (s, playerId, now) => ({ kind: 'quiz', game: quizViewFor(s, playerId, now) }),
    batched: () => false,
  };
}

export type GameState = PictionaryState | QuizState;
export type AnyGameAdapter = GameAdapter<GameState, PictionaryEvent | QuizEvent>;

/**
 * The adapter for a room's game. The room's `game` kind decides which state it stores, so the
 * adapter only ever sees its own state and events (hence the cast).
 */
export function adapterFor(kind: GameKind, db: D1Database): AnyGameAdapter {
  const adapter = kind === 'quiz' ? quizAdapter(db) : pictionaryAdapter(db);
  return adapter as unknown as AnyGameAdapter;
}
