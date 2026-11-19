import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BASE } from './helpers';

const PASSWORD = 'test-password';
const A = `${BASE}/api/admin`;
const JSON_H = { 'content-type': 'application/json' };

let seq = 0;
const freshTheme = () => `Adm ${++seq} ${crypto.randomUUID().slice(0, 6)}`;
const q = (theme: string, question: string, answer = 'rep', variants: string[] = []) => ({ theme, question, answer, variants });

async function login(password = PASSWORD): Promise<string> {
  const res = await SELF.fetch(`${A}/login`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ password }) });
  expect(res.status).toBe(204);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

function call(path: string, cookie: string | null, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch(`${A}${path}`, {
    method,
    headers: { ...(method !== 'GET' ? JSON_H : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM questions').first<{ n: number }>())!.n;

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

afterEach(() => vi.restoreAllMocks());

describe('admin auth', () => {
  it('rejects every route without a cookie and writes nothing', async () => {
    await env.DB.prepare('DELETE FROM words').run();
    const before = await count();
    const theme = freshTheme();
    const routes: [string, string, unknown?][] = [
      ['GET', '/me'],
      ['GET', '/questions'],
      ['POST', '/questions', q(theme, 'Q ?')],
      ['PUT', '/questions/1', q(theme, 'Q ?')],
      ['DELETE', '/questions/1'],
      ['POST', '/import', { questions: [q(theme, 'Q ?')] }],
      ['GET', '/export'],
      ['GET', '/words'],
      ['PUT', '/words', { words: ['chat'] }],
      ['POST', '/logout'],
    ];
    for (const [method, path, body] of routes) {
      const res = await call(path, null, method, body);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(await count()).toBe(before);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM words').first<{ n: number }>())!.n).toBe(0);
  });

  it('rejects a wrong password', async () => {
    const res = await SELF.fetch(`${A}/login`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ password: 'nope' }) });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a malformed login body', async () => {
    const res = await SELF.fetch(`${A}/login`, { method: 'POST', headers: JSON_H, body: '{' });
    expect(res.status).toBe(401);
  });

  it('login sets a hardened cookie that unlocks /me; logout clears it', async () => {
    const res = await SELF.fetch(`${A}/login`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ password: PASSWORD }) });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^kg_admin=\d+\.[0-9a-f]+;/);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/admin', 'Max-Age=2592000']) expect(setCookie).toContain(part);
    const cookie = setCookie.split(';')[0]!;
    expect((await call('/me', cookie)).status).toBe(204);
    const out = await call('/logout', cookie, 'POST');
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('omits Secure on http://localhost', async () => {
    const res = await SELF.fetch('http://localhost/api/admin/login', { method: 'POST', headers: JSON_H, body: JSON.stringify({ password: PASSWORD }) });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('rejects tampered and expired cookies', async () => {
    const cookie = await login();
    const [exp, sig] = cookie.slice('kg_admin='.length).split('.') as [string, string];
    expect((await call('/me', `kg_admin=${Number(exp) + 1000}.${sig}`)).status).toBe(401);
    expect((await call('/me', `kg_admin=${exp}.${sig.replace(/.$/, sig.endsWith('0') ? '1' : '0')}`)).status).toBe(401);
    expect((await call('/me', 'kg_admin=garbage')).status).toBe(401);
    const past = String(Date.now() - 1000);
    expect((await call('/me', `kg_admin=${past}.${await hmac(past, env.ADMIN_SECRET)}`)).status).toBe(401);
    const future = String(Date.now() + 60_000);
    expect((await call('/me', `kg_admin=${future}.${await hmac(future, env.ADMIN_SECRET)}`)).status).toBe(204);
  });

  it('requires a JSON content type on mutating routes', async () => {
    const cookie = await login();
    const before = await count();
    const res = await SELF.fetch(`${A}/questions`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' },
      body: JSON.stringify(q(freshTheme(), 'CSRF ?')),
    });
    expect(res.status).toBe(415);
    expect((await call('/questions/1', cookie, 'DELETE', undefined, { 'content-type': 'text/plain' })).status).toBe(415);
    expect(await count()).toBe(before);
  });

  it('answers 503 admin_disabled when the password or secret is unset', async () => {
    const { default: worker } = await import('../src/index');
    for (const patch of [{ ADMIN_PASSWORD: '' }, { ADMIN_SECRET: '' }]) {
      const res = await worker.fetch(
        new Request(`${A}/login`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ password: '' }) }),
        { ...env, ...patch },
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'admin_disabled' });
      expect((await worker.fetch(new Request(`${A}/me`), { ...env, ...patch })).status).toBe(503);
    }
  });
});

describe('admin questions', () => {
  it('create / list / update / delete round trip', async () => {
    const cookie = await login();
    const theme = freshTheme();
    const created = await call('/questions', cookie, 'POST', q(theme, '  Capitale de la France ?  ', 'Paris', ['paris']));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: number };

    const list = (await (await call(`/questions?theme=${encodeURIComponent(theme)}`, cookie)).json()) as {
      items: { id: number; theme: string; question: string; answer: string; variants: string[]; source: string; createdAt: number; lastUsedAt: number | null }[];
      total: number; page: number; pageSize: number;
    };
    expect(list.total).toBe(1);
    expect(list.page).toBe(1);
    expect(list.pageSize).toBe(50);
    expect(list.items[0]).toMatchObject({ id, theme, question: 'Capitale de la France ?', answer: 'Paris', variants: ['paris'], source: 'manuel', lastUsedAt: null });
    expect(typeof list.items[0]!.createdAt).toBe('number');

    const put = await call(`/questions/${id}`, cookie, 'PUT', q(theme, 'Capitale de la France ?', 'Paris (75)', []));
    expect(put.status).toBe(200);
    const after = (await (await call(`/questions?theme=${encodeURIComponent(theme)}`, cookie)).json()) as typeof list;
    expect(after.items[0]).toMatchObject({ answer: 'Paris (75)', variants: [] });

    expect((await call(`/questions/${id}`, cookie, 'DELETE')).status).toBe(204);
    expect(((await (await call(`/questions?theme=${encodeURIComponent(theme)}`, cookie)).json()) as typeof list).total).toBe(0);
  });

  it('rejects duplicates (409) and invalid questions (400)', async () => {
    const cookie = await login();
    const theme = freshTheme();
    expect((await call('/questions', cookie, 'POST', q(theme, 'Doublon ?'))).status).toBe(201);
    expect((await call('/questions', cookie, 'POST', q(theme, '  DOUBLON  ?'))).status).toBe(409);
    expect((await call('/questions', cookie, 'POST', q(theme, '', 'x'))).status).toBe(400);
    expect((await call('/questions', cookie, 'POST', { question: 1 })).status).toBe(400);
    expect((await call('/questions', cookie, 'POST', [q(theme, 'Liste ?')])).status).toBe(400);
    expect((await call('/questions', cookie, 'POST', q('x'.repeat(41), 'Trop long ?'))).status).toBe(400);
  });

  it('PUT validates, 409 on a key collision with another row, 404 on an unknown id', async () => {
    const cookie = await login();
    const theme = freshTheme();
    const a = ((await (await call('/questions', cookie, 'POST', q(theme, 'Alpha ?'))).json()) as { id: number }).id;
    const b = ((await (await call('/questions', cookie, 'POST', q(theme, 'Beta ?'))).json()) as { id: number }).id;
    expect((await call(`/questions/${b}`, cookie, 'PUT', q(theme, 'alpha ?'))).status).toBe(409);
    expect((await call(`/questions/${b}`, cookie, 'PUT', q(theme, '', 'x'))).status).toBe(400);
    expect((await call(`/questions/${a}`, cookie, 'PUT', q(theme, 'Alpha ?', 'changé'))).status).toBe(200);
    expect((await call('/questions/999999999', cookie, 'PUT', q(theme, 'Gamma ?'))).status).toBe(404);
    expect((await call('/questions/abc', cookie, 'PUT', q(theme, 'Gamma ?'))).status).toBe(404);
    expect((await call('/questions/999999999', cookie, 'DELETE')).status).toBe(404);
  });

  it('filters by q (question or answer, case-insensitive) and theme, and paginates', async () => {
    const cookie = await login();
    const theme = freshTheme();
    const other = freshTheme();
    await call('/import', cookie, 'POST', {
      questions: [
        ...Array.from({ length: 55 }, (_, i) => q(theme, `Question numéro ${i} ?`, `réponse ${i}`)),
        q(other, 'Une QUESTION spéciale ?', 'Zébulon'),
      ],
    });
    const get = async (qs: string) =>
      (await (await call(`/questions?${qs}`, cookie)).json()) as { items: { question: string }[]; total: number; page: number };
    const p1 = await get(`theme=${encodeURIComponent(theme)}`);
    expect(p1.total).toBe(55);
    expect(p1.items).toHaveLength(50);
    const p2 = await get(`theme=${encodeURIComponent(theme)}&page=2`);
    expect(p2.page).toBe(2);
    expect(p2.items).toHaveLength(5);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.question)).size).toBe(55);
    expect((await get(`theme=${encodeURIComponent(other)}&q=SPÉCIALE`)).total).toBe(1);
    expect((await get(`theme=${encodeURIComponent(other)}&q=spéciale`)).total).toBe(1);
    expect((await get(`theme=${encodeURIComponent(other)}&q=ZÉBULON`)).total).toBe(1);
    expect((await get(`theme=${encodeURIComponent(theme)}&q=zébulon`)).total).toBe(0);
    expect((await get(`theme=${encodeURIComponent(theme)}&q=50%25`)).total).toBe(0);
    // page is clamped to ceil(total / 50) + 1
    const far = await get(`theme=${encodeURIComponent(theme)}&page=9999`);
    expect(far.page).toBe(3);
    expect(far.items).toEqual([]);
    expect((await get(`theme=${encodeURIComponent(theme)}&page=-4`)).page).toBe(1);
    expect((await get(`theme=${encodeURIComponent(theme)}&page=abc`)).page).toBe(1);
    expect((await get(`theme=${encodeURIComponent(theme)}&q=numéro&page=9999`)).page).toBe(3);
    expect((await get(`theme=${encodeURIComponent(theme)}&q=${encodeURIComponent('numéro 5')}`)).total).toBe(6);
  });
});

describe('admin import / export', () => {
  it('imports valid questions, skips duplicates and reports invalid ones', async () => {
    const cookie = await login();
    const theme = freshTheme();
    await call('/questions', cookie, 'POST', q(theme, 'Déjà là ?'));
    const res = await call('/import', cookie, 'POST', {
      questions: [q(theme, 'Nouvelle un ?'), q(theme, 'déjà  la ?'), q(theme, 'Nouvelle deux ?'), { theme, question: '', answer: 'x', variants: [] }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inserted: number; duplicates: number; errors: { index: number; reason: string }[] };
    expect(body.inserted).toBe(2);
    expect(body.duplicates).toBe(1);
    expect(body.errors).toEqual([{ index: 3, reason: expect.any(String) }]);
  });

  it('counts duplicates within the file, defaults and sets the source', async () => {
    const cookie = await login();
    const theme = freshTheme();
    const body = (await (await call('/import', cookie, 'POST', { questions: [q(theme, 'Même ?'), q(theme, 'MEME ?')] })).json()) as { inserted: number; duplicates: number };
    expect(body).toMatchObject({ inserted: 1, duplicates: 1 });
    await call('/import', cookie, 'POST', { questions: [q(theme, 'Générée ?')], source: 'généré' });
    const rows = (await env.DB.prepare('SELECT question, source FROM questions WHERE theme = ? ORDER BY id').bind(theme).all<{ question: string; source: string }>()).results;
    expect(rows).toEqual([{ question: 'Même ?', source: 'manuel' }, { question: 'Générée ?', source: 'généré' }]);
    expect((await call('/import', cookie, 'POST', { questions: [], source: 'autre' })).status).toBe(400);
  });

  it('rejects more than 1000 questions with 413 too_many and a bad document with 400', async () => {
    const cookie = await login();
    const theme = freshTheme();
    const before = await count();
    const res = await call('/import', cookie, 'POST', { questions: Array.from({ length: 1001 }, (_, i) => q(theme, `Q${i} ?`)) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_many' });
    expect(await count()).toBe(before);
    expect((await call('/import', cookie, 'POST', { nope: 1 })).status).toBe(400);
  });

  it('imports a large batch in a single D1 batch', async () => {
    const cookie = await login();
    const theme = freshTheme();
    const batch = vi.spyOn(env.DB, 'batch');
    const body = (await (await call('/import', cookie, 'POST', { questions: Array.from({ length: 1000 }, (_, i) => q(theme, `Gros ${i} ?`, 'r', ['v'])) })).json()) as { inserted: number };
    expect(body.inserted).toBe(1000);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('export round-trips through import (nothing inserted, all duplicates)', async () => {
    const cookie = await login();
    const theme = freshTheme();
    await call('/import', cookie, 'POST', { questions: [q(theme, 'Export un ?', 'a', ['b']), q(theme, 'Export deux ?', 'c')] });
    const all = (await (await call('/export', cookie)).json()) as { questions: { theme: string; question: string; answer: string; variants: string[] }[] };
    const exported = { questions: all.questions.filter((x) => x.theme === theme) };
    expect(exported.questions).toEqual([q(theme, 'Export un ?', 'a', ['b']), q(theme, 'Export deux ?', 'c')]);
    const again = (await (await call('/import', cookie, 'POST', exported)).json()) as { inserted: number; duplicates: number; errors: unknown[] };
    expect(again.inserted).toBe(0);
    expect(again.duplicates).toBe(exported.questions.length);
    expect(again.errors).toEqual([]);
  });
});

describe('admin words', () => {
  it('replaces the list, trimming and deduping by normalize', async () => {
    const cookie = await login();
    expect((await call('/words', cookie, 'PUT', { words: ['  Chat ', 'chat', 'ÉLÉPHANT', 'elephant', '', 'Maison'] })).status).toBe(200);
    const { words } = (await (await call('/words', cookie)).json()) as { words: string[] };
    expect([...words].sort()).toEqual(['Chat', 'ÉLÉPHANT', 'Maison'].sort());
    await call('/words', cookie, 'PUT', { words: ['Seul'] });
    expect(((await (await call('/words', cookie)).json()) as { words: string[] }).words).toEqual(['Seul']);
    await call('/words', cookie, 'PUT', { words: [] });
    expect(((await (await call('/words', cookie)).json()) as { words: string[] }).words).toEqual([]);
  });

  it('keeps the old list when the replacement fails', async () => {
    const cookie = await login();
    await call('/words', cookie, 'PUT', { words: ['ancien'] });
    vi.spyOn(env.DB, 'batch').mockRejectedValue(new Error('d1 down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call('/words', cookie, 'PUT', { words: ['nouveau'] })).status).toBe(500);
    vi.restoreAllMocks();
    expect(((await (await call('/words', cookie)).json()) as { words: string[] }).words).toEqual(['ancien']);
  });

  it('rejects too long words, too many words and bad bodies, keeping the old list', async () => {
    const cookie = await login();
    await call('/words', cookie, 'PUT', { words: ['garde'] });
    expect((await call('/words', cookie, 'PUT', { words: ['x'.repeat(31)] })).status).toBe(400);
    expect((await call('/words', cookie, 'PUT', { words: Array.from({ length: 5001 }, (_, i) => `mot${i}`) })).status).toBe(400);
    expect((await call('/words', cookie, 'PUT', { words: [1] })).status).toBe(400);
    expect((await call('/words', cookie, 'PUT', {})).status).toBe(400);
    expect(((await (await call('/words', cookie)).json()) as { words: string[] }).words).toEqual(['garde']);
    const batch = vi.spyOn(env.DB, 'batch');
    const many = (await call('/words', cookie, 'PUT', { words: Array.from({ length: 5000 }, (_, i) => `mot${i}`) }));
    expect(many.status).toBe(200);
    expect(batch).toHaveBeenCalledTimes(1);
    batch.mockRestore();
    expect(((await (await call('/words', cookie)).json()) as { words: string[] }).words).toHaveLength(5000);
  });
});

describe('themes endpoint', () => {
  it('returns json {error:internal} 500 when D1 fails', async () => {
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('d1 down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await SELF.fetch(`${BASE}/api/themes`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal' });
  });
});
