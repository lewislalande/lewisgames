export type Player = { id: string; name: string; connected: boolean; joinedAt: number };
export type Room = {
  code: string;
  game: 'pictionary';
  hostId: string | null;
  /** The room's creator (first joiner). Takes host back on rejoin; only they see the custom words. */
  ownerId: string | null;
  players: Player[];
  /** token → playerId, server-only */
  tokens: Record<string, string>;
};

export type JoinResult =
  | { ok: true; room: Room; playerId: string; rejoined: boolean }
  | { ok: false; error: 'room_full' | 'bad_name' | 'bad_token' };

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 5;
const MAX_NAME = 20;
const MAX_TOKEN = 128;

export function generateCode(rng: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const idx = Math.min(CODE_ALPHABET.length - 1, Math.floor(rng() * CODE_ALPHABET.length));
    code += CODE_ALPHABET[idx];
  }
  return code;
}

export function createRoom(code: string, game: 'pictionary'): Room {
  return { code, game, hostId: null, ownerId: null, players: [], tokens: {} };
}

// `crypto` is a global in Node 22 and Workers; declared here since the shared lib config has no DOM/node types.
declare const crypto: { randomUUID(): string };

const defaultNewId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 8);

export function joinRoom(
  room: Room,
  token: string,
  name: string,
  now: number,
  maxPlayers: number,
  newId: () => string = defaultNewId,
): JoinResult {
  if (token.length < 1 || token.length > MAX_TOKEN) return { ok: false, error: 'bad_token' };
  const clean = name.trim();
  if (clean.length < 1 || clean.length > MAX_NAME) return { ok: false, error: 'bad_name' };

  const knownId = Object.prototype.hasOwnProperty.call(room.tokens, token) ? room.tokens[token] : undefined;
  const known = knownId === undefined ? undefined : room.players.find((p) => p.id === knownId);
  if (known) {
    const players = room.players.map((p) =>
      p.id === known.id ? { ...p, name: clean, connected: true } : p,
    );
    return {
      ok: true,
      room: {
        ...room,
        players,
        ownerId: room.ownerId ?? null,
        hostId: known.id === room.ownerId ? known.id : room.hostId ?? known.id,
      },
      playerId: known.id,
      rejoined: true,
    };
  }

  if (room.players.length >= maxPlayers) return { ok: false, error: 'room_full' };
  const id = newId();
  const player: Player = { id, name: clean, connected: true, joinedAt: now };
  return {
    ok: true,
    room: {
      ...room,
      players: [...room.players, player],
      tokens: { ...room.tokens, [token]: id },
      hostId: room.hostId ?? id,
      ownerId: room.ownerId ?? id,
    },
    playerId: id,
    rejoined: false,
  };
}

export function connectedPlayers(room: Room): Player[] {
  return room.players.filter((p) => p.connected);
}

export function disconnect(room: Room, playerId: string): Room {
  const players = room.players.map((p) => (p.id === playerId ? { ...p, connected: false } : p));
  let hostId = room.hostId;
  if (hostId === playerId) {
    const next = players
      .filter((p) => p.connected)
      .reduce<Player | null>((best, p) => (best === null || p.joinedAt < best.joinedAt ? p : best), null);
    hostId = next ? next.id : null;
  }
  return { ...room, players, hostId };
}
