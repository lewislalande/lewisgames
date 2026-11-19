import { DurableObject } from 'cloudflare:workers';
import {
  connectedPlayers, createRoom, disconnect, initialState, joinRoom, parseClientMsg, reduce, viewFor,
  type ClientMsg, type Effect, type ErrorCode, type GameEvent, type PictionaryState, type Room, type ServerMsg,
} from '@kg/shared';
import words from '@kg/shared/src/pictionary/words-fr.json';
import type { Env } from './index';

type Stored = { room: Room; game: PictionaryState };
type Attachment = { playerId: string } | null;

const STORAGE_KEY = 'state';
/** An empty room is deleted after this long. */
const IDLE_MS = 10 * 60 * 1000;
const WORDS: string[] = words;

const send = (ws: WebSocket, msg: ServerMsg): void => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket already closing; its close handler cleans up.
  }
};

const playerOf = (ws: WebSocket): string | null => (ws.deserializeAttachment() as Attachment)?.playerId ?? null;

function toEvent(msg: Exclude<ClientMsg, { t: 'hello' }>, by: string): GameEvent {
  switch (msg.t) {
    case 'settings': return { type: 'setSettings', by, settings: msg.settings };
    case 'start': return { type: 'start', by };
    case 'restart': return { type: 'restart', by };
    case 'choose': return { type: 'chooseWord', by, index: msg.index };
    case 'guess': return { type: 'guess', by, text: msg.text };
    case 'reveal': return { type: 'revealLetter', by, index: msg.index };
    case 'draw': return { type: 'draw', by, op: msg.op };
  }
}

export class RoomDO extends DurableObject<Env> {
  private data: Stored | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<Stored>(STORAGE_KEY)) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return this.upgrade();
    const { pathname } = new URL(request.url);
    if (pathname === '/init' && request.method === 'POST') {
      if (this.data) return new Response(null, { status: 409 });
      const { code } = (await request.json()) as { code: string };
      this.data = { room: createRoom(code, 'pictionary'), game: initialState() };
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
    await this.apply(toEvent(msg, playerId));
  }

  private async hello(ws: WebSocket, token: string, name: string): Promise<void> {
    const data = this.data!;
    const result = joinRoom(data.room, token, name, Date.now(), data.game.settings.maxPlayers);
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
    if (!this.data) return;
    if (connectedPlayers(this.data.room).length === 0) {
      this.data = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.apply({ type: 'timeout' });
  }

  /** Runs one game event against the current room, persists, reschedules and delivers effects. */
  private async apply(event: GameEvent): Promise<void> {
    const data = this.data!;
    const now = Date.now();
    const { state, effects } = reduce(data.game, event, { now, rng: Math.random, room: data.room, words: WORDS });
    data.game = state;
    await this.persist();
    for (const effect of effects) this.deliver(effect, now);
  }

  private async persist(): Promise<void> {
    const { room, game } = this.data!;
    await this.ctx.storage.put(STORAGE_KEY, { room, game } satisfies Stored);
    if (connectedPlayers(room).length === 0) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    else if (game.phaseEndsAt !== null) await this.ctx.storage.setAlarm(game.phaseEndsAt);
    else await this.ctx.storage.deleteAlarm();
  }

  private sockets(): { ws: WebSocket; playerId: string }[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      const playerId = playerOf(ws);
      return playerId ? [{ ws, playerId }] : [];
    });
  }

  private deliver(effect: Effect, now: number): void {
    const { room, game } = this.data!;
    switch (effect.type) {
      case 'state': {
        const players = room.players.map(({ id, name, connected }) => ({ id, name, connected }));
        for (const { ws, playerId } of this.sockets()) {
          send(ws, { t: 'state', players, hostId: room.hostId, game: viewFor(game, playerId, now, room.hostId) });
        }
        return;
      }
      case 'draw':
        for (const { ws, playerId } of this.sockets()) {
          if (playerId !== game.drawerId) send(ws, { t: 'draw', op: effect.op });
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
