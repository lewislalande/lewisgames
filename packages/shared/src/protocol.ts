import type { DrawOp } from './pictionary/game';
import type { PictionaryView } from './pictionary/view';

export type ClientMsg =
  | { t: 'hello'; token: string; name: string }
  | { t: 'settings'; settings: unknown }
  | { t: 'start' }
  | { t: 'restart' }
  | { t: 'choose'; index: number }
  | { t: 'guess'; text: string }
  | { t: 'reveal'; index: number }
  | { t: 'draw'; op: DrawOp };

export type ErrorCode = 'room_full' | 'bad_name' | 'bad_token' | 'not_found' | 'bad_message';

export type ServerMsg =
  | { t: 'welcome'; playerId: string }
  | { t: 'state'; players: { id: string; name: string; connected: boolean }[]; hostId: string | null; game: PictionaryView }
  | { t: 'draw'; op: DrawOp }
  | { t: 'notice'; notice: 'close' | 'correct' }
  | { t: 'error'; code: ErrorCode };

/** Largest accepted client frame (a full 2000-point stroke fits comfortably). */
export const MAX_CLIENT_MSG_LENGTH = 64 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Checks the envelope only (message type and field types). Game-level validation
 * (draw actions, indices in range, settings clamping) is the reducer's job.
 */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_CLIENT_MSG_LENGTH) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(m)) return null;
  switch (m.t) {
    case 'hello':
      return typeof m.token === 'string' && typeof m.name === 'string' ? { t: 'hello', token: m.token, name: m.name } : null;
    case 'settings':
      return 'settings' in m ? { t: 'settings', settings: m.settings } : null;
    case 'start':
    case 'restart':
      return { t: m.t };
    case 'choose':
    case 'reveal':
      return typeof m.index === 'number' ? { t: m.t, index: m.index } : null;
    case 'guess':
      return typeof m.text === 'string' ? { t: 'guess', text: m.text } : null;
    case 'draw':
      return isObject(m.op) && typeof m.op.op === 'string' ? { t: 'draw', op: m.op as DrawOp } : null;
    default:
      return null;
  }
}
