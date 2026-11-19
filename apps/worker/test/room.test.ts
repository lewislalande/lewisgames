import { SELF, env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { ServerMsg } from '@kg/shared';

type StateMsg = Extract<ServerMsg, { t: 'state' }>;
const BASE = 'https://kg.test';

async function createRoom(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game: 'pictionary' }),
  });
  expect(res.status).toBe(201);
  const { code } = (await res.json()) as { code: string };
  return code;
}

/** A test WebSocket client that records every frame and lets the test wait for specific ones. */
class Client {
  readonly raw: string[] = [];
  readonly msgs: ServerMsg[] = [];
  closed: { code: number; reason: string } | null = null;
  private cursor = 0;
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const data = e.data as string;
      this.raw.push(data);
      this.msgs.push(JSON.parse(data) as ServerMsg);
      this.wake();
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code, reason: e.reason };
      this.wake();
    });
  }

  static async open(code: string): Promise<Client> {
    const res = await SELF.fetch(`${BASE}/api/rooms/${code}/ws`, { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const client = new Client(ws);
    ws.accept();
    return client;
  }

  static async join(code: string, token: string, name: string): Promise<{ c: Client; playerId: string }> {
    const c = await Client.open(code);
    c.send({ t: 'hello', token, name });
    const welcome = await c.next((m) => m.t === 'welcome');
    return { c, playerId: (welcome as Extract<ServerMsg, { t: 'welcome' }>).playerId };
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Next message (after the last one consumed) matching `pred`; earlier non-matching ones are skipped. */
  async next(pred: (m: ServerMsg) => boolean = () => true, timeoutMs = 3000): Promise<ServerMsg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.cursor < this.msgs.length) {
        const m = this.msgs[this.cursor++]!;
        if (pred(m)) return m;
      }
      if (this.closed) throw new Error(`socket closed (${this.closed.code} ${this.closed.reason})`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('timed out waiting for message');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  nextState(pred: (m: StateMsg) => boolean = () => true): Promise<StateMsg> {
    return this.next((m) => m.t === 'state' && pred(m)) as Promise<StateMsg>;
  }

  async waitClosed(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('socket not closed');
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.closed;
  }
}

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
    const cState = await cc.nextState((m) => m.game.chat.some((e) => e.text === '« B a trouvé ! »'));
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
