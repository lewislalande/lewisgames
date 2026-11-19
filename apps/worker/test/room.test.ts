import { SELF, env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { PictionaryState, Room } from '@kg/shared';
import { BASE, Client, createRoom, until, type StateMsg } from './helpers';

describe('HTTP API', () => {
  it('creates a room with a valid code', async () => {
    const code = await createRoom();
    expect(code).toMatch(/^[A-HJ-NP-Z]{5}$/);
    const res = await SELF.fetch(`${BASE}/api/rooms/${code}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ game: 'pictionary' });
  });

  it('returns 404 for an unknown room', async () => {
    const res = await SELF.fetch(`${BASE}/api/rooms/ZZZZZ`);
    expect(res.status).toBe(404);
  });

  it('rejects an unknown game', async () => {
    const res = await SELF.fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ game: 'chess' }) });
    expect(res.status).toBe(400);
  });

  it('closes a websocket to an unknown room with not_found', async () => {
    const c = await Client.open('ZZZZY');
    expect(await c.next()).toEqual({ t: 'error', code: 'not_found' });
    await c.waitClosed();
  });

  it('deletes an abandoned room when its alarm fires', async () => {
    const code = await createRoom();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await SELF.fetch(`${BASE}/api/rooms/${code}`)).status).toBe(404);
  });
});

describe('room websocket', () => {
  it('plays a turn without leaking the word, and reconnect restores seat and drawing', async () => {
    const code = await createRoom();
    const word = 'zeppelin';

    const { c: a, playerId: aId } = await Client.join(code, 'tok-a', 'A');
    const { c: b, playerId: bId } = await Client.join(code, 'tok-b', 'B');
    for (const c of [a, b]) {
      const s = await c.nextState((m) => m.players.length === 2);
      expect(s.hostId).toBe(aId);
      expect(s.players.map((p) => p.name)).toEqual(['A', 'B']);
    }
    const { c: cc } = await Client.join(code, 'tok-c', 'C');
    await a.nextState((m) => m.players.length === 3);

    a.send({ t: 'settings', settings: { customWords: [word], customWordsMode: 'only', wordChoices: 1 } });
    await a.nextState((m) => m.game.settings.customWordsMode === 'only');

    a.send({ t: 'start' });
    for (const c of [a, b, cc]) {
      const s = await c.nextState((m) => m.game.phase !== 'lobby');
      expect(s.game.phase).toBe('choosing');
      expect(s.game.drawerId).toBe(aId);
    }

    a.send({ t: 'choose', index: 0 });
    const drawing = await a.nextState((m) => m.game.phase === 'drawing');
    expect(drawing.game.word).toBe(word);
    await b.nextState((m) => m.game.phase === 'drawing');
    await cc.nextState((m) => m.game.phase === 'drawing');

    // Drawer draws: B receives the op, the drawer does not get it echoed.
    const stroke = { id: 's1', kind: 'stroke', tool: 'pen', color: '#000000', size: 4, opacity: 1, points: [[10, 10], [20, 20]] };
    a.send({ t: 'draw', op: { op: 'add', action: stroke } });
    expect(await b.next((m) => m.t === 'draw')).toEqual({ t: 'draw', op: { op: 'add', action: stroke } });

    // A wrong guess from B, so A gets a state after the draw would have been delivered.
    b.send({ t: 'guess', text: 'ballon' });
    await a.nextState((m) => m.game.chat.some((e) => e.text === 'ballon'));
    expect(a.msgs.some((m) => m.t === 'draw')).toBe(false);

    const bBeforeFound = b.raw.length;
    b.send({ t: 'guess', text: 'ZEPPELIN' });
    expect(await b.next((m) => m.t === 'notice')).toEqual({ t: 'notice', notice: 'correct' });
    const cState = await cc.nextState((m) => m.game.chat.some((e) => e.text === 'B a trouvé !'));
    expect(cState.game.phase).toBe('drawing');
    expect(cState.game.found).toEqual([bId]);

    // No frame sent to a guesser who hasn't found it ever contains the word.
    for (const raw of [...cc.raw, ...b.raw.slice(0, bBeforeFound)]) {
      expect(raw.toLowerCase()).not.toContain(word);
    }
    expect(cc.msgs.some((m) => m.t === 'notice')).toBe(false);

    // B refreshes: same seat, same score, full drawing history.
    const before = b.msgs.filter((m): m is StateMsg => m.t === 'state').at(-1)!;
    const actionsBefore = before.game.history.actions.length;
    expect(actionsBefore).toBe(1);
    const scoreBefore = before.game.scores[bId];
    expect(scoreBefore).toBeGreaterThan(0);
    b.ws.close(1000, 'bye');
    await a.nextState((m) => m.players.find((p) => p.id === bId)?.connected === false);

    const { c: b2, playerId: b2Id } = await Client.join(code, 'tok-b', 'B');
    expect(b2Id).toBe(bId);
    const restored = await b2.nextState();
    expect(restored.players.find((p) => p.id === bId)?.connected).toBe(true);
    expect(restored.game.history.actions.length).toBe(actionsBefore);
    expect(restored.game.scores[bId]).toBe(scoreBefore);
    expect(restored.game.hasFound).toBe(true);
    expect(restored.game.word).toBe(word);
  });

  it('answers malformed JSON with bad_message and keeps the socket open', async () => {
    const code = await createRoom();
    const c = await Client.open(code);
    c.send('{nope');
    expect(await c.next()).toEqual({ t: 'error', code: 'bad_message' });
    c.send({ t: 'hello', token: 'tok', name: 'Ana' });
    expect((await c.next()).t).toBe('welcome');
    c.send('{"t":"dance"}');
    expect(await c.next((m) => m.t === 'error')).toEqual({ t: 'error', code: 'bad_message' });
    expect(c.closed).toBeNull();
  });

  it('only accepts hello before hello', async () => {
    const code = await createRoom();
    const c = await Client.open(code);
    c.send({ t: 'start' });
    expect(await c.next()).toEqual({ t: 'error', code: 'bad_message' });
    expect(c.closed).toBeNull();
  });

  it('sends the hello error then closes the socket', async () => {
    const code = await createRoom();
    const c = await Client.open(code);
    c.send({ t: 'hello', token: 'tok', name: '   ' });
    expect(await c.next()).toEqual({ t: 'error', code: 'bad_name' });
    await c.waitClosed();

    const d = await Client.open(code);
    d.send({ t: 'hello', token: '', name: 'Ana' });
    expect(await d.next()).toEqual({ t: 'error', code: 'bad_token' });
    await d.waitClosed();
  });

  it('refuses players beyond settings.maxPlayers', async () => {
    const code = await createRoom();
    const { c: a } = await Client.join(code, 'tok-a', 'A');
    a.send({ t: 'settings', settings: { maxPlayers: 2 } });
    await a.nextState((m) => m.game.settings.maxPlayers === 2);
    await Client.join(code, 'tok-b', 'B');
    const c = await Client.open(code);
    c.send({ t: 'hello', token: 'tok-c', name: 'C' });
    expect(await c.next()).toEqual({ t: 'error', code: 'room_full' });
    await c.waitClosed();
  });

  it('keeps a player connected while another of their tabs is open', async () => {
    const code = await createRoom();
    const { c: a } = await Client.join(code, 'tok-a', 'A');
    const { c: tab1, playerId: bId } = await Client.join(code, 'tok-b', 'B');
    const { c: tab2, playerId: bId2 } = await Client.join(code, 'tok-b', 'B');
    expect(bId2).toBe(bId);
    await tab2.nextState();

    tab1.ws.close(1000, 'bye');
    // A settings change forces a fresh state after the close has been handled.
    await new Promise((r) => setTimeout(r, 100));
    a.send({ t: 'settings', settings: { rounds: 2 } });
    const s = await tab2.nextState((m) => m.game.settings.rounds === 2);
    expect(s.players.find((p) => p.id === bId)?.connected).toBe(true);

    tab2.ws.close(1000, 'bye');
    await a.nextState((m) => m.players.find((p) => p.id === bId)?.connected === false);
  });
});

type Stored = { room: Room; game: PictionaryState };
const stubFor = (code: string) => env.ROOM.get(env.ROOM.idFromName(code));
const readStored = (code: string) =>
  runInDurableObject(stubFor(code), async (_i, state) => (await state.storage.get<Stored>('state'))!);
const readAlarm = (code: string) => runInDurableObject(stubFor(code), (_i, state) => state.storage.getAlarm());

describe('alarms', () => {
  it('sets the idle alarm when everyone leaves and keeps the room once someone is back', async () => {
    const code = await createRoom();
    const { c: a } = await Client.join(code, 'tok-a', 'A');
    expect(await readAlarm(code)).toBeNull();

    a.ws.close(1000, 'bye');
    await until(() => readStored(code), (s) => !s.room.players[0]!.connected);
    const alarm = await readAlarm(code);
    expect(alarm).toBeGreaterThan(Date.now() + 9 * 60 * 1000);

    const { c: a2 } = await Client.join(code, 'tok-a', 'A');
    await a2.nextState();
    expect(await readAlarm(code)).toBeNull();
    // Even if the stale idle alarm fired now, a room with a live player survives.
    await runInDurableObject(stubFor(code), (_i, state) => state.storage.setAlarm(Date.now() + 60 * 60 * 1000));
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(true);
    expect((await SELF.fetch(`${BASE}/api/rooms/${code}`)).status).toBe(200);
  });

  it('decides idleness from open sockets, not from the stored connected flags', async () => {
    const code = await createRoom();
    const { c: a } = await Client.join(code, 'tok-a', 'A');
    a.ws.close(1000, 'bye');
    await until(() => readStored(code), (s) => !s.room.players[0]!.connected);
    // A stale flag claims A is still connected, but no socket is open.
    await runInDurableObject(stubFor(code), (instance) => {
      const data = (instance as unknown as { data: Stored }).data;
      data.room = { ...data.room, players: data.room.players.map((p) => ({ ...p, connected: true })) };
    });
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(true);
    expect((await SELF.fetch(`${BASE}/api/rooms/${code}`)).status).toBe(404);
  });

  it('advances the phase when the choosing timer fires', async () => {
    const code = await createRoom();
    const { c: a } = await Client.join(code, 'tok-a', 'A');
    const { c: b } = await Client.join(code, 'tok-b', 'B');
    a.send({ t: 'start' });
    const choosing = await b.nextState((m) => m.game.phase === 'choosing');
    expect(await readAlarm(code)).toBe(choosing.game.phaseEndsAt);

    // Pretend the choosing time is over.
    await runInDurableObject(stubFor(code), (instance) => {
      (instance as unknown as { data: Stored }).data.game.phaseEndsAt = Date.now() - 1;
    });
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(true);
    const drawing = await b.nextState((m) => m.game.phase === 'drawing');
    expect(drawing.game.mask).not.toBeNull();
    expect((await a.nextState((m) => m.game.phase === 'drawing')).game.word).not.toBeNull();
  });
});

describe('restart reconciliation', () => {
  it('disconnects players stored as connected but without a socket, handing the host over', async () => {
    const code = await createRoom();
    const { c: a, playerId: aId } = await Client.join(code, 'tok-a', 'A');
    const { c: b } = await Client.join(code, 'tok-b', 'B');
    await b.nextState((m) => m.players.length === 2);

    // A ghost host: stored as connected, joined first, but with no socket (as after a deploy).
    await runInDurableObject(stubFor(code), async (_i, state) => {
      const s = (await state.storage.get<Stored>('state'))!;
      const ghost = { id: 'ghost', name: 'G', connected: true, joinedAt: 0 };
      s.room = { ...s.room, hostId: 'ghost', players: [ghost, ...s.room.players], tokens: { ...s.room.tokens, 'tok-g': 'ghost' } };
      await state.storage.put('state', s);
    });
    await evictDurableObject(stubFor(code), { webSockets: 'hibernate' });

    // The next message wakes a fresh instance, which must drop the ghost before handling it.
    a.send({ t: 'settings', settings: { rounds: 4 } });
    const s = await a.nextState((m) => m.game.settings.rounds === 4);
    expect(s.hostId).toBe(aId);
    expect(s.players.find((p) => p.id === 'ghost')?.connected).toBe(false);
    expect(s.players.filter((p) => p.connected)).toHaveLength(2);
  });

  it('lets an empty room be cleaned up after a restart', async () => {
    const code = await createRoom();
    const { c: a } = await Client.join(code, 'tok-a', 'A');
    await a.nextState();
    await evictDurableObject(stubFor(code), { webSockets: 'close' });
    // The room is stored with A connected, but A's socket is gone.
    expect((await readStored(code)).room.players[0]!.connected).toBe(false);
    expect(await readAlarm(code)).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(true);
    expect((await SELF.fetch(`${BASE}/api/rooms/${code}`)).status).toBe(404);
  });
});

describe('storage writes', () => {
  type Counted = { writes: number };
  const writesOf = (code: string) => runInDurableObject(stubFor(code), (instance) => (instance as unknown as Counted).writes);

  async function drawingRoom() {
    const code = await createRoom();
    const { c: a, playerId: aId } = await Client.join(code, 'tok-a', 'A');
    const { c: b } = await Client.join(code, 'tok-b', 'B');
    a.send({ t: 'start' });
    await a.nextState((m) => m.game.phase === 'choosing');
    a.send({ t: 'choose', index: 0 });
    await a.nextState((m) => m.game.phase === 'drawing');
    await b.nextState((m) => m.game.phase === 'drawing');
    return { code, a, aId, b };
  }

  it('batches draw ops: far fewer writes than ops, and a flush survives eviction', async () => {
    const { code, a, b } = await drawingRoom();
    const before = await writesOf(code);
    const N = 60;
    a.send({ t: 'draw', op: { op: 'add', action: { id: 's1', kind: 'stroke', tool: 'pen', color: '#000000', size: 4, opacity: 1, points: [[1, 1]] } } });
    for (let i = 0; i < N; i++) a.send({ t: 'draw', op: { op: 'append', id: 's1', points: [[i, i]] } });
    // Every op is still relayed immediately.
    for (let i = 0; i <= N; i++) await b.next((m) => m.t === 'draw');
    expect((await writesOf(code)) - before).toBeLessThanOrEqual(2);

    // Within ~2 s the batched strokes reach storage.
    const stored = await until(() => readStored(code), (s) => s.game.history.actions[0]?.kind === 'stroke' && (s.game.history.actions[0] as { points: unknown[] }).points.length === N + 1, 4000);
    expect(stored.game.phase).toBe('drawing');

    await evictDurableObject(stubFor(code), { webSockets: 'hibernate' });
    b.send({ t: 'guess', text: 'pas-le-mot-zzz' });
    const s = await b.nextState((m) => m.game.chat.some((e) => e.text === 'pas-le-mot-zzz'));
    const first = s.game.history.actions[0] as { points: unknown[] };
    expect(first.points).toHaveLength(N + 1);
  });

  it('flushes pending strokes on a non-draw event', async () => {
    const { code, a, b } = await drawingRoom();
    a.send({ t: 'draw', op: { op: 'add', action: { id: 's1', kind: 'stroke', tool: 'pen', color: '#000000', size: 4, opacity: 1, points: [[1, 1]] } } });
    await b.next((m) => m.t === 'draw');
    b.send({ t: 'guess', text: 'pas-le-mot-zzz' });
    await a.nextState((m) => m.game.chat.some((e) => e.text === 'pas-le-mot-zzz'));
    expect((await readStored(code)).game.history.actions).toHaveLength(1);
  });

  it('does not rewrite an unchanged alarm', async () => {
    const { code, a, b } = await drawingRoom();
    const before = await runInDurableObject(stubFor(code), (instance) => (instance as unknown as { alarmWrites: number }).alarmWrites);
    for (const text of ['un', 'deux', 'trois']) {
      b.send({ t: 'guess', text: `${text}-zzz` });
      await a.nextState((m) => m.game.chat.some((e) => e.text === `${text}-zzz`));
    }
    const after = await runInDurableObject(stubFor(code), (instance) => (instance as unknown as { alarmWrites: number }).alarmWrites);
    expect(after).toBe(before);
  });
});

describe('owner and custom words', () => {
  it('a promoted host never sees the custom words, and the owner takes host back', async () => {
    const code = await createRoom();
    const { c: a, playerId: aId } = await Client.join(code, 'tok-a', 'A');
    const { c: b, playerId: bId } = await Client.join(code, 'tok-b', 'B');
    a.send({ t: 'settings', settings: { customWords: ['zorglub', 'plouf'], customWordsMode: 'only' } });
    expect((await a.nextState((m) => m.game.customWordsCount === 2)).ownerId).toBe(aId);
    a.ws.close(1000, 'bye');
    const promoted = await b.nextState((m) => m.hostId === bId);
    expect(promoted.game.settings.customWords).toEqual([]);
    // The promoted host edits a setting: the owner's words survive.
    b.send({ t: 'settings', settings: { ...promoted.game.settings, customWords: undefined, rounds: 5 } });
    await b.nextState((m) => m.game.settings.rounds === 5);
    expect(b.raw.join('')).not.toContain('zorglub');

    const { c: a2 } = await Client.join(code, 'tok-a', 'A');
    const back = await a2.nextState();
    expect(back.hostId).toBe(aId);
    expect(back.game.settings.customWords).toEqual(['zorglub', 'plouf']);
  });
});
