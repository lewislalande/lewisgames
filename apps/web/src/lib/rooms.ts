import { GAME_KINDS, type GameKind } from '@kg/shared';

const isGameKind = (v: unknown): v is GameKind => GAME_KINDS.includes(v as GameKind);

/** Which game a room plays: the kind, 'not_found', or null when the API could not tell (offline, 5xx, timeout). */
export async function fetchRoomGame(code: string): Promise<GameKind | 'not_found' | null> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return 'not_found';
    if (!res.ok) return null;
    const { game } = (await res.json()) as { game?: unknown };
    return isGameKind(game) ? game : null;
  } catch {
    return null;
  }
}

export const roomPath = (game: GameKind, code: string): string => `/${game}/${code}`;
