import type { Room } from '../room';
import type { Point } from './drawing';
import type { PictionaryState, Result } from './game';

/** Reducer helpers shared by the Classique and imposter rules. */

export const changed = (state: PictionaryState): Result => ({ state, effects: [{ type: 'state' }] });
export const unchanged = (state: PictionaryState): Result => ({ state, effects: [] });

export const isConnected = (room: Room, id: string): boolean =>
  room.players.some((p) => p.id === id && p.connected);

export const isPoint = (p: unknown): p is Point =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));

export function gameOver(s: PictionaryState): Result {
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
