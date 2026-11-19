import { normalize, parseImport, questionKey, type ImportedQuestion } from '@kg/shared';
import type { Env } from './index';

const COOKIE = 'kg_admin';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PAGE_SIZE = 50;
const FAILED_LOGIN_DELAY_MS = 500;
const MAX_IMPORT = 1000;
const MAX_WORDS = 5000;
const MAX_WORD_LENGTH = 30;
/** Bound parameters allowed per D1 statement. */
const CHUNK = 100;
const SOURCES = ['manuel', 'généré'] as const;
type Source = (typeof SOURCES)[number];

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const empty = (status: number, headers?: HeadersInit): Response => new Response(null, { status, headers });
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------------------- session

async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two strings of any length (both are hashed to equal-length digests first). */
async function safeEqual(a: string, b: string, secret: string): Promise<boolean> {
  const [x, y] = await Promise.all([sign(a, secret), sign(b, secret)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function readCookie(request: Request): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

async function isLoggedIn(request: Request, env: Env): Promise<boolean> {
  const value = readCookie(request);
  const dot = value?.indexOf('.') ?? -1;
  if (!value || dot < 1) return false;
  const exp = value.slice(0, dot);
  if (!/^\d+$/.test(exp) || Number(exp) <= Date.now()) return false;
  return safeEqual(value.slice(dot + 1), await sign(exp, env.ADMIN_SECRET), env.ADMIN_SECRET);
}

function cookieHeader(request: Request, value: string, maxAge: number): string {
  const { protocol, hostname } = new URL(request.url);
  const local = protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  return `${COOKIE}=${value}; HttpOnly;${local ? '' : ' Secure;'} SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}`;
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const password = (body as { password?: unknown } | null)?.password;
  if (typeof password !== 'string' || !(await safeEqual(password, env.ADMIN_PASSWORD, env.ADMIN_SECRET))) {
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return json({ error: 'unauthorized' }, 401);
  }
  const exp = String(Date.now() + SESSION_SECONDS * 1000);
  return empty(204, { 'set-cookie': cookieHeader(request, `${exp}.${await sign(exp, env.ADMIN_SECRET)}`, SESSION_SECONDS) });
}

// --------------------------------------------------------------------------------------- helpers

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

type Row = {
  id: number; theme: string; question: string; answer: string; variants: string;
  source: string; created_at: number; last_used_at: number | null;
};

function parseVariants(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Validates one question with the import rules; the reason is French, for the admin UI. */
function parseOne(body: unknown): { ok: ImportedQuestion } | { reason: string } {
  const { ok, errors } = parseImport({ questions: [body] });
  return ok[0] ? { ok: ok[0] } : { reason: errors[0]?.reason ?? 'question invalide' };
}

const insertQuestion = (db: D1Database, q: ImportedQuestion, source: Source, now: number) =>
  db
    .prepare('INSERT OR IGNORE INTO questions (theme, question, question_key, answer, variants, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(q.theme, q.question, questionKey(q.question), q.answer, JSON.stringify(q.variants), source, now);

// -------------------------------------------------------------------------------------- questions

async function listQuestions(url: URL, db: D1Database): Promise<Response> {
  const theme = url.searchParams.get('theme') ?? '';
  const needle = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const requested = Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1);
  const clamp = (total: number) => Math.min(requested, Math.ceil(total / PAGE_SIZE) + 1);
  const where = theme ? 'WHERE theme = ?' : '';
  const binds = theme ? [theme] : [];
  let rows: Row[];
  let total: number;
  let page: number;
  if (needle) {
    // SQLite's LIKE only folds ASCII case; the bank is small, so filter here to fold accents' case too.
    const { results } = await db.prepare(`SELECT * FROM questions ${where} ORDER BY id`).bind(...binds).all<Row>();
    const hits = results.filter((r) => r.question.toLowerCase().includes(needle) || r.answer.toLowerCase().includes(needle));
    total = hits.length;
    page = clamp(total);
    rows = hits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  } else {
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM questions ${where}`).bind(...binds).first<{ n: number }>();
    total = count?.n ?? 0;
    page = clamp(total);
    rows = (await db.prepare(`SELECT * FROM questions ${where} ORDER BY id LIMIT ? OFFSET ?`).bind(...binds, PAGE_SIZE, (page - 1) * PAGE_SIZE).all<Row>()).results;
  }
  const items = rows.map((r) => ({
    id: r.id, theme: r.theme, question: r.question, answer: r.answer, variants: parseVariants(r.variants),
    source: r.source, createdAt: r.created_at, lastUsedAt: r.last_used_at,
  }));
  return json({ items, total, page, pageSize: PAGE_SIZE });
}

async function createQuestion(request: Request, db: D1Database): Promise<Response> {
  const parsed = parseOne(await readJson(request));
  if (!('ok' in parsed)) return json({ error: 'invalid', reason: parsed.reason }, 400);
  const res = await insertQuestion(db, parsed.ok, 'manuel', Date.now()).run();
  if (res.meta.changes === 0) return json({ error: 'duplicate' }, 409);
  return json({ id: res.meta.last_row_id }, 201);
}

async function updateQuestion(request: Request, db: D1Database, id: number): Promise<Response> {
  const parsed = parseOne(await readJson(request));
  if (!('ok' in parsed)) return json({ error: 'invalid', reason: parsed.reason }, 400);
  const q = parsed.ok;
  if (!(await db.prepare('SELECT id FROM questions WHERE id = ?').bind(id).first())) return json({ error: 'not_found' }, 404);
  const key = questionKey(q.question);
  if (await db.prepare('SELECT id FROM questions WHERE question_key = ? AND id != ?').bind(key, id).first()) {
    return json({ error: 'duplicate' }, 409);
  }
  try {
    await db
      .prepare('UPDATE questions SET theme = ?, question = ?, question_key = ?, answer = ?, variants = ? WHERE id = ?')
      .bind(q.theme, q.question, key, q.answer, JSON.stringify(q.variants), id)
      .run();
  } catch (err) {
    // A concurrent write took the key between the check above and this update.
    if (/UNIQUE/i.test(String(err))) return json({ error: 'duplicate' }, 409);
    throw err;
  }
  return json({ id });
}

async function deleteQuestion(db: D1Database, id: number): Promise<Response> {
  const res = await db.prepare('DELETE FROM questions WHERE id = ?').bind(id).run();
  return res.meta.changes === 0 ? json({ error: 'not_found' }, 404) : empty(204);
}

async function importQuestions(request: Request, db: D1Database): Promise<Response> {
  const body = await readJson(request);
  const raw = (body as { questions?: unknown } | null)?.questions;
  if (Array.isArray(raw) && raw.length > MAX_IMPORT) return json({ error: 'too_many' }, 413);
  const source = (body as { source?: unknown } | null)?.source ?? 'manuel';
  if (!SOURCES.includes(source as Source)) return json({ error: 'bad_source' }, 400);
  const { ok, errors } = parseImport(body);
  if (errors.some((e) => e.index === -1)) return json({ error: 'invalid', reason: errors[0]!.reason }, 400);
  const now = Date.now();
  const results = ok.length > 0 ? await db.batch(ok.map((q) => insertQuestion(db, q, source as Source, now))) : [];
  const inserted = results.reduce((n, r) => n + r.meta.changes, 0);
  return json({ inserted, duplicates: ok.length - inserted, errors });
}

async function exportQuestions(db: D1Database): Promise<Response> {
  const { results } = await db.prepare('SELECT theme, question, answer, variants FROM questions ORDER BY id').all<Row>();
  return json({ questions: results.map((r) => ({ theme: r.theme, question: r.question, answer: r.answer, variants: parseVariants(r.variants) })) });
}

// -------------------------------------------------------------------------------------------- words

async function getWords(db: D1Database): Promise<Response> {
  const { results } = await db.prepare('SELECT word FROM words ORDER BY word').all<{ word: string }>();
  return json({ words: results.map((r) => r.word) });
}

async function putWords(request: Request, db: D1Database): Promise<Response> {
  const raw = ((await readJson(request)) as { words?: unknown } | null)?.words;
  if (!Array.isArray(raw) || raw.some((w) => typeof w !== 'string')) return json({ error: 'invalid' }, 400);
  const byKey = new Map<string, string>();
  for (const w of raw as string[]) {
    const word = w.normalize('NFC').trim();
    if (!word) continue;
    if (word.length > MAX_WORD_LENGTH) return json({ error: 'invalid', reason: `un mot dépasse ${MAX_WORD_LENGTH} caractères` }, 400);
    if (!byKey.has(normalize(word))) byKey.set(normalize(word), word);
  }
  const words = [...byKey.values()];
  if (words.length > MAX_WORDS) return json({ error: 'invalid', reason: `plus de ${MAX_WORDS} mots` }, 400);
  // One batch = one atomic D1 query: the old list is never left half replaced (and the free plan
  // caps queries per invocation). Multi-row inserts stay within D1's 100 bound parameters.
  const statements = [db.prepare('DELETE FROM words')];
  for (let i = 0; i < words.length; i += CHUNK) {
    const part = words.slice(i, i + CHUNK);
    statements.push(db.prepare(`INSERT INTO words (word) VALUES ${part.map(() => '(?)').join(', ')}`).bind(...part));
  }
  await db.batch(statements);
  return json({ count: words.length });
}

// ------------------------------------------------------------------------------------------ router

const QUESTION_PATH = /^\/api\/admin\/questions\/([^/]+)$/;

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SECRET) return json({ error: 'admin_disabled' }, 503);
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;
  const idMatch = QUESTION_PATH.exec(pathname);

  const routes: Record<string, string[]> = {
    '/api/admin/login': ['POST'],
    '/api/admin/logout': ['POST'],
    '/api/admin/me': ['GET'],
    '/api/admin/questions': ['GET', 'POST'],
    '/api/admin/import': ['POST'],
    '/api/admin/export': ['GET'],
    '/api/admin/words': ['GET', 'PUT'],
  };
  const allowed = idMatch ? ['PUT', 'DELETE'] : routes[pathname];
  if (!allowed) return json({ error: 'not_found' }, 404);
  if (!allowed.includes(method)) return json({ error: 'method' }, 405);

  try {
    if (pathname !== '/api/admin/login' && !(await isLoggedIn(request, env))) return json({ error: 'unauthorized' }, 401);
    // Not a CORS-simple type: a cross-site form cannot send it (second line of defence after SameSite=Strict).
    if (method !== 'GET' && !(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return json({ error: 'content_type' }, 415);
    }
    if (idMatch) {
      const id = /^\d+$/.test(idMatch[1]!) ? Number(idMatch[1]) : NaN;
      if (!Number.isSafeInteger(id)) return json({ error: 'not_found' }, 404);
      return method === 'PUT' ? await updateQuestion(request, env.DB, id) : await deleteQuestion(env.DB, id);
    }
    switch (`${method} ${pathname}`) {
      case 'POST /api/admin/login': return await login(request, env);
      case 'POST /api/admin/logout': return empty(204, { 'set-cookie': cookieHeader(request, '', 0) });
      case 'GET /api/admin/me': return empty(204);
      case 'GET /api/admin/questions': return await listQuestions(url, env.DB);
      case 'POST /api/admin/questions': return await createQuestion(request, env.DB);
      case 'POST /api/admin/import': return await importQuestions(request, env.DB);
      case 'GET /api/admin/export': return await exportQuestions(env.DB);
      case 'GET /api/admin/words': return await getWords(env.DB);
      default: return await putWords(request, env.DB);
    }
  } catch (err) {
    console.error('admin request failed', err);
    return json({ error: 'internal' }, 500);
  }
}
