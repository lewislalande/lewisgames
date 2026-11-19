import { SELF } from 'cloudflare:test';
import { expect } from 'vitest';
import type { ServerMsg } from '@kg/shared';

type AnyStateMsg = Extract<ServerMsg, { t: 'state' }>;
export type StateMsg = Extract<AnyStateMsg, { kind: 'pictionary' }>;
export type QuizStateMsg = Extract<AnyStateMsg, { kind: 'quiz' }>;
export const BASE = 'https://kg.test';

export async function createRoom(game: 'pictionary' | 'quiz' = 'pictionary'): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game }),
  });
  expect(res.status).toBe(201);
  const { code } = (await res.json()) as { code: string };
  return code;
}

/** A test WebSocket client that records every frame and lets the test wait for specific ones. */
export class Client {
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

  /** Next Pictionary state matching `pred`. */
  nextState(pred: (m: StateMsg) => boolean = () => true): Promise<StateMsg> {
    return this.next((m) => m.t === 'state' && m.kind === 'pictionary' && pred(m)) as Promise<StateMsg>;
  }

  /** Next quiz state matching `pred`. */
  nextQuiz(pred: (m: QuizStateMsg) => boolean = () => true): Promise<QuizStateMsg> {
    return this.next((m) => m.t === 'state' && m.kind === 'quiz' && pred(m)) as Promise<QuizStateMsg>;
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

/** Polls `read` until `ok` holds. */
export async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 20));
  }
}
