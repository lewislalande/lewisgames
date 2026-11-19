import { CODE_ALPHABET, generateCode } from '@kg/shared';

export { RoomDO } from './room-do';

export type Env = {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
};

const CREATE_ATTEMPTS = 5;
const ROOM_PATH = new RegExp(`^/api/rooms/([${CODE_ALPHABET}]{5})(/ws)?$`);

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

const roomStub = (env: Env, code: string): DurableObjectStub => env.ROOM.get(env.ROOM.idFromName(code));

async function createRoom(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const game = (body as { game?: unknown } | null)?.game;
  if (game !== 'pictionary') return json({ error: 'bad_game' }, 400);
  for (let i = 0; i < CREATE_ATTEMPTS; i++) {
    const code = generateCode(Math.random);
    const res = await roomStub(env, code).fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ code, game }),
    });
    if (res.status === 201) return json({ code }, 201);
    if (res.status !== 409) return json({ error: 'internal' }, 500);
  }
  return json({ error: 'no_code' }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/rooms') {
      return request.method === 'POST' ? createRoom(request, env) : json({ error: 'method' }, 405);
    }
    const match = ROOM_PATH.exec(pathname);
    if (match) {
      const stub = roomStub(env, match[1]!);
      if (match[2]) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'upgrade' }, 426);
        return stub.fetch(request);
      }
      if (request.method !== 'GET') return json({ error: 'method' }, 405);
      return stub.fetch('https://room/info');
    }
    if (pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
