import { maskWord } from './hints';
import type { DrawingHistory } from './drawing';
import type { ChatEntry, Phase, PictionaryState } from './game';
import { DEFAULT_SETTINGS, type PictionarySettings } from './settings';
import { imposterViewFor, type ImposterView } from './imposter';

export type PictionaryView = {
  phase: Phase;
  /** `customWords` is emptied for everyone but the room owner (see `customWordsCount`). */
  settings: PictionarySettings;
  customWordsCount: number;
  round: number;
  drawerId: string | null;
  isDrawer: boolean;
  hasFound: boolean;
  /** Only for the drawer, players who found it, and everyone at turnEnd / gameOver. */
  word: string | null;
  mask: string[] | null;
  revealed: number[];
  hintsLeft: number;
  /** Drawer only, during choosing. */
  wordChoices: string[] | null;
  phaseEndsAt: number | null;
  drawStartedAt: number | null;
  serverNow: number;
  found: string[];
  scores: Record<string, number>;
  turnPoints: Record<string, number>;
  history: DrawingHistory;
  chat: ChatEntry[];
  turnOrder: string[];
  mode: PictionarySettings['mode'];
  /** Imposter mode, during a manche only. */
  imp: ImposterView | null;
};

/** `ownerId` is the room creator: the only player allowed to read the custom word list. */
export function viewFor(state: PictionaryState, viewerId: string, now: number, ownerId: string | null): PictionaryView {
  const isDrawer = state.drawerId !== null && state.drawerId === viewerId;
  const hasFound = state.found.some((f) => f.playerId === viewerId);
  const ended = state.phase === 'turnEnd' || state.phase === 'gameOver';
  const canSeeWord = ended || (state.phase === 'drawing' && (isDrawer || hasFound));
  // Rooms stored before a setting existed lack it: the client always gets a full set.
  const settings: PictionarySettings = { ...DEFAULT_SETTINGS, ...state.settings };
  const showMask = (state.phase === 'drawing' || state.phase === 'turnEnd') && state.word !== null;
  return {
    phase: state.phase,
    settings: ownerId !== null && viewerId === ownerId ? settings : { ...settings, customWords: [] },
    customWordsCount: state.settings.customWords.length,
    round: state.round,
    drawerId: state.drawerId,
    isDrawer,
    hasFound,
    word: canSeeWord ? state.word : null,
    mask: showMask ? maskWord(state.word!, state.revealed) : null,
    revealed: state.revealed,
    hintsLeft: Math.max(0, state.settings.maxHints - state.revealed.length),
    wordChoices: state.phase === 'choosing' && isDrawer ? state.wordChoices : null,
    phaseEndsAt: state.phaseEndsAt,
    drawStartedAt: state.drawStartedAt,
    serverNow: now,
    found: state.found.map((f) => f.playerId),
    scores: state.scores,
    turnPoints: state.turnPoints,
    history: state.history,
    chat: state.chat,
    turnOrder: state.turnOrder,
    mode: settings.mode === 'imposteur' ? 'imposteur' : 'classique',
    imp: imposterViewFor(state, viewerId),
  };
}
