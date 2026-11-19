import { DurableObject } from 'cloudflare:workers';
import {
  connectedPlayers, createRoom, disconnect, GAME_KINDS, joinRoom, parseClientMsg,
  type ErrorCode, type GameKind, type Room, type ServerMsg,
} from '@kg/shared';
import { adapterFor, type AnyGameAdapter, type GameState, type RoomEffect, type RoomEvent } from './games';
import type { Env } from './index';

type Stored = { room: Room; game: GameState };
type AnyEvent = Parameters<AnyGameAdapter['reduce']>[1];
type Commit = (prev: GameState, next: GameState) => Promise<void>;
type Attachment = { playerId: string } | null;

const STORAGE_KEY = 'state';
/** An empty room is deleted after this long. */
const IDLE_MS = 10 * 60 * 1000;
/**
 * Draw ops (one every ~40 ms while drawing) are relayed at once but persisted at most this often:
 * the free plan allows 100k rows written per day. A restart loses at most this much drawing.
 */
const DRAW_FLUSH_MS = 2000;

const send = (ws: WebSocket, msg: ServerMsg): void => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket already closing; its close handler cleans up.
  }
};

const playerOf = (ws: WebSocket): string | null => (ws.deserializeAttachment() as Attachment)?.playerId ?? null;

const isGameKind = (v: unknown): v is GameKind => GAME_KINDS.includes(v as GameKind);

export class RoomDO extends DurableObject<Env> {
  private data: Stored | null = null;
  /** The game rules of `data.room.game`; set whenever `data` is. */
  private adapter: AnyGameAdapter | null = null;
  /** Alarm time last written to storage (null: none), so unchanged alarms are not rewritten. */
  private alarmAt: number | null = null;
  /** Pending draw-only changes not yet in storage, flushed by `flushTimer`. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Storage write counters (state puts, alarm sets/deletes), read by tests. */
  writes = 0;
  alarmWrites = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<Stored>(STORAGE_KEY)) ?? null;
      this.alarmAt = await ctx.storage.getAlarm();
      if (this.data) {
        this.adapter = adapterFor(this.data.room.game, env.DB);
        this.data.game = await this.adapter.resume(this.data.game);
        await this.dropGhosts();
      }
    });
  }

  /**
   * After a restart (deploy, eviction) sockets can vanish without `webSocketClose`: anyone stored
   * as connected without a live socket leaves through the same path as a close.
   */
  private async dropGhosts(): Promise<void> {
    const live = this.livePlayerIds();
    for (const p of this.data!.room.players) {
      if (!p.connected || live.has(p.id)) continue;
      this.data!.room = disconnect(this.data!.room, p.id);
      await this.apply({ type: 'playerLeft', playerId: p.id });
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return this.upgrade();
    const { pathname } = new URL(request.url);
    if (pathname === '/init' && request.method === 'POST') {
      if (this.data) return new Response(null, { status: 409 });
      const { code, game } = (await request.json()) as { code: string; game: unknown };
      if (!isGameKind(game)) return new Response(null, { status: 400 });
      this.adapter = adapterFor(game, this.env.DB);
      this.data = { room: createRoom(code, game), game: this.adapter.initial() };
      await this.persist();
      return new Response(null, { status: 201 });
    }
    if (pathname === '/info') {
      return this.data ? Response.json({ game: this.data.room.game }) : new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  }

  private upgrade(): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(null);
    if (!this.data) this.reject(server, 'not_found');
    return new Response(null, { status: 101, webSocket: client });
  }

  private reject(ws: WebSocket, code: ErrorCode): void {
    send(ws, { t: 'error', code });
    ws.close(1008, code);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.data) return this.reject(ws, 'not_found');
    const msg = typeof raw === 'string' ? parseClientMsg(raw) : null;
    if (!msg) return send(ws, { t: 'error', code: 'bad_message' });
    const playerId = playerOf(ws);
    if (msg.t === 'hello') {
      if (playerId) return send(ws, { t: 'error', code: 'bad_message' });
      return this.hello(ws, msg.token, msg.name);
    }
    if (!playerId) return send(ws, { t: 'error', code: 'bad_message' });
    const event = this.adapter!.toEvent(msg, playerId);
    if (!event) return send(ws, { t: 'error', code: 'bad_message' });
    const prepared = await this.adapter!.prepare(this.data.game, event, this.data.room);
    if (!this.data) return; // deleted while loading
    // A refusal goes to the sender only and leaves their socket open.
    if (!prepared.ok) return send(ws, { t: 'error', code: prepared.error });
    await this.apply(prepared.event, prepared.commit);
  }

  private async hello(ws: WebSocket, token: string, name: string): Promise<void> {
    const data = this.data!;
    const result = joinRoom(data.room, token, name, Date.now(), this.adapter!.maxPlayers(data.game));
    if (!result.ok) return this.reject(ws, result.error);
    data.room = result.room;
    ws.serializeAttachment({ playerId: result.playerId } satisfies Attachment);
    send(ws, { t: 'welcome', playerId: result.playerId });
    await this.apply({ type: 'playerJoined', playerId: result.playerId });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
    await this.leave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  /** Marks the player disconnected once their last socket is gone. */
  private async leave(ws: WebSocket): Promise<void> {
    const playerId = playerOf(ws);
    if (!this.data || !playerId) return;
    try {
      ws.serializeAttachment(null); // close and error can both fire: leave only once
    } catch {
      // Attachment is not writable on some closed sockets; the s !== ws check below still applies.
    }
    const stillOpen = this.ctx.getWebSockets().some((s) => s !== ws && playerOf(s) === playerId);
    if (stillOpen) return;
    this.data.room = disconnect(this.data.room, playerId);
    await this.apply({ type: 'playerLeft', playerId });
  }

  async alarm(): Promise<void> {
    this.alarmAt = null; // consumed
    if (!this.data) return;
    if (this.livePlayerIds().size === 0) {
      this.cancelFlush();
      this.data = null;
      this.adapter = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    // Phase timeout; reduce ignores it if the phase is not over yet (e.g. a stale alarm).
    await this.apply({ type: 'timeout' });
  }

  /**
   * Runs one game event against the current room and delivers its effects, then persists:
   * at once for most events, batched (≤ DRAW_FLUSH_MS) for the game's frequent ones (draw ops).
   * `commit` (from the adapter's prepare) runs last.
   */
  private async apply(event: AnyEvent | RoomEvent, commit?: Commit): Promise<void> {
    const data = this.data!;
    const adapter = this.adapter!;
    const now = Date.now();
    const prev = data.game;
    const { state, effects } = adapter.reduce(prev, event, { now, room: data.room });
    data.game = state;
    // Deliver first: a failing storage write must not freeze the game for the players.
    for (const effect of effects) this.deliver(effect, now);
    if (adapter.batched(event)) {
      if (effects.length > 0) this.scheduleFlush();
    } else {
      await this.persist();
    }
    if (commit) await commit(prev, state);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.data) void this.persist();
    }, DRAW_FLUSH_MS);
  }

  private cancelFlush(): void {
    if (this.flushTimer === null) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  /** Writes the full state and the alarm it implies. Errors are logged, never thrown. */
  private async persist(): Promise<void> {
    this.cancelFlush();
    const { room, game } = this.data!;
    try {
      this.writes++;
      await this.ctx.storage.put(STORAGE_KEY, { room, game } satisfies Stored);
      const target =
        connectedPlayers(room).length === 0 ? Date.now() + IDLE_MS : this.adapter!.phaseEndsAt(game);
      if (target === this.alarmAt) return;
      this.alarmWrites++;
      if (target === null) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(target);
      this.alarmAt = target;
    } catch (err) {
      console.error('room persist failed', err);
    }
  }

  private livePlayerIds(): Set<string> {
    return new Set(this.sockets().map((s) => s.playerId));
  }

  private sockets(): { ws: WebSocket; playerId: string }[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      const playerId = playerOf(ws);
      return playerId ? [{ ws, playerId }] : [];
    });
  }

  private deliver(effect: RoomEffect, now: number): void {
    const { room, game } = this.data!;
    switch (effect.type) {
      case 'state': {
        const players = room.players.map(({ id, name, connected }) => ({ id, name, connected }));
        const common = { t: 'state', players, hostId: room.hostId, ownerId: room.ownerId ?? null } as const;
        for (const { ws, playerId } of this.sockets()) {
          send(ws, { ...common, ...this.adapter!.view(game, playerId, now, room) });
        }
        return;
      }
      case 'draw':
        for (const { ws, playerId } of this.sockets()) {
          if (playerId !== effect.except) send(ws, { t: 'draw', op: effect.op });
        }
        return;
      case 'private':
        for (const { ws, playerId } of this.sockets()) {
          if (playerId === effect.to) send(ws, { t: 'notice', notice: effect.notice });
        }
        return;
    }
  }
}
