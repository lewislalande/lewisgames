import { describe, it, expect } from 'vitest';
import {
  CODE_ALPHABET, generateCode, createRoom, joinRoom, disconnect, connectedPlayers,
  type Room,
} from '../src/room';

const counter = () => { let n = 0; return () => `id${++n}`; };

function join(room: Room, token: string, name: string, now = 1, max = 8, newId = counter()) {
  const r = joinRoom(room, token, name, now, max, newId);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('generateCode', () => {
  it('returns 5 chars from the alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateCode(Math.random);
      expect(c).toHaveLength(5);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });
  it('handles rng edge values', () => {
    expect(generateCode(() => 0)).toBe('AAAAA');
    expect(generateCode(() => 0.999999)).toHaveLength(5);
  });
});

describe('joinRoom', () => {
  it('first player is host', () => {
    const nid = counter();
    let room = createRoom('ABCDE', 'pictionary');
    const a = join(room, 't1', 'Alice', 1, 8, nid);
    const b = join(a.room, 't2', 'Bob', 2, 8, nid);
    expect(b.room.hostId).toBe(a.playerId);
    expect(b.room.players).toHaveLength(2);
    expect(b.rejoined).toBe(false);
    expect(room.players).toHaveLength(0);
  });

  it('uses a default 8-char id', () => {
    const r = joinRoom(createRoom('ABCDE', 'pictionary'), 't1', 'A', 1, 8);
    expect(r.ok && r.playerId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('host transfers on leave', () => {
    const nid = counter();
    const a = join(createRoom('ABCDE', 'pictionary'), 't1', 'Alice', 1, 8, nid);
    const b = join(a.room, 't2', 'Bob', 2, 8, nid);
    const left = disconnect(b.room, a.playerId);
    expect(left.hostId).toBe(b.playerId);
    expect(connectedPlayers(left).map(p => p.name)).toEqual(['Bob']);
    const none = disconnect(left, b.playerId);
    expect(none.hostId).toBeNull();
  });

  it('non-host leaving keeps host', () => {
    const nid = counter();
    const a = join(createRoom('ABCDE', 'pictionary'), 't1', 'Alice', 1, 8, nid);
    const b = join(a.room, 't2', 'Bob', 2, 8, nid);
    expect(disconnect(b.room, b.playerId).hostId).toBe(a.playerId);
  });

  it('host transfers to earliest-joined connected player', () => {
    const nid = counter();
    let r = join(createRoom('ABCDE', 'pictionary'), 't1', 'A', 1, 8, nid);
    const a = r.playerId;
    const b = join(r.room, 't2', 'B', 2, 8, nid);
    const c = join(b.room, 't3', 'C', 3, 8, nid);
    let room = disconnect(c.room, b.playerId);
    room = disconnect(room, a);
    expect(room.hostId).toBe(c.playerId);
  });

  it('rejoin with same token reuses player and becomes host if none', () => {
    const nid = counter();
    const a = join(createRoom('ABCDE', 'pictionary'), 't1', 'Alice', 1, 8, nid);
    const gone = disconnect(a.room, a.playerId);
    expect(gone.hostId).toBeNull();
    const back = join(gone, 't1', 'Alicia', 5, 8, nid);
    expect(back.playerId).toBe(a.playerId);
    expect(back.rejoined).toBe(true);
    expect(back.room.hostId).toBe(a.playerId);
    expect(back.room.players[0]).toMatchObject({ name: 'Alicia', connected: true, joinedAt: 1 });
    expect(back.room.players).toHaveLength(1);
  });

  it('rejoin while still connected returns same player', () => {
    const nid = counter();
    const a = join(createRoom('ABCDE', 'pictionary'), 't1', 'Alice', 1, 8, nid);
    const again = join(a.room, 't1', 'Alice', 2, 8, nid);
    expect(again.playerId).toBe(a.playerId);
    expect(again.rejoined).toBe(true);
    expect(again.room.players).toHaveLength(1);
  });

  it('rejects the ninth new player but lets a known token rejoin', () => {
    const nid = counter();
    let room = createRoom('ABCDE', 'pictionary');
    for (let i = 0; i < 8; i++) room = join(room, `t${i}`, `P${i}`, i, 8, nid).room;
    const r = joinRoom(room, 't9', 'Late', 99, 8, nid);
    expect(r).toEqual({ ok: false, error: 'room_full' });
    const p0 = room.players[0].id;
    room = disconnect(room, p0);
    const back = joinRoom(room, 't0', 'P0', 100, 8, nid);
    expect(back.ok && back.rejoined).toBe(true);
  });

  it('rejects bad names', () => {
    const room = createRoom('ABCDE', 'pictionary');
    expect(joinRoom(room, 't', '   ', 1, 8)).toEqual({ ok: false, error: 'bad_name' });
    expect(joinRoom(room, 't', 'x'.repeat(21), 1, 8)).toEqual({ ok: false, error: 'bad_name' });
    const ok = joinRoom(room, 't', `  ${'x'.repeat(20)}  `, 1, 8);
    expect(ok.ok && ok.room.players[0].name).toBe('x'.repeat(20));
  });

  it('records the first joiner as owner', () => {
    const nid = counter();
    expect(createRoom('ABCDE', 'pictionary').ownerId).toBeNull();
    const a = join(createRoom('ABCDE', 'pictionary'), 't1', 'Alice', 1, 8, nid);
    const b = join(a.room, 't2', 'Bob', 2, 8, nid);
    expect(b.room.ownerId).toBe(a.playerId);
    expect(disconnect(b.room, a.playerId).ownerId).toBe(a.playerId);
  });

  it('owner rejoining takes host back', () => {
    const nid = counter();
    const a = join(createRoom('ABCDE', 'pictionary'), 't1', 'Alice', 1, 8, nid);
    const b = join(a.room, 't2', 'Bob', 2, 8, nid);
    const c = join(b.room, 't3', 'Cleo', 3, 8, nid);
    const left = disconnect(c.room, a.playerId);
    expect(left.hostId).toBe(b.playerId);
    const back = join(left, 't1', 'Alice', 4, 8, nid);
    expect(back.room.hostId).toBe(a.playerId);
    // A non-owner rejoining does not take host.
    const bGone = disconnect(back.room, b.playerId);
    expect(join(bGone, 't2', 'Bob', 5, 8, nid).room.hostId).toBe(a.playerId);
  });

  it('a legacy room without ownerId adopts the next joiner as owner', () => {
    const legacy = { code: 'ABCDE', game: 'pictionary', hostId: null, players: [], tokens: {} } as unknown as Room;
    expect(join(legacy, 't1', 'A', 1, 8, counter()).room.ownerId).toBe('id1');
  });

  it('rejects bad tokens', () => {
    const room = createRoom('ABCDE', 'pictionary');
    expect(joinRoom(room, '', 'A', 1, 8)).toEqual({ ok: false, error: 'bad_token' });
    expect(joinRoom(room, 'x'.repeat(129), 'A', 1, 8)).toEqual({ ok: false, error: 'bad_token' });
    expect(joinRoom(room, 'x'.repeat(128), 'A', 1, 8).ok).toBe(true);
  });
});
