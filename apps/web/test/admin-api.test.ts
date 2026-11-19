import { afterEach, expect, test, vi } from 'vitest';
import { adminApi } from '../src/admin/api';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

test('mutations send Content-Type: application/json, GETs do not need a body', async () => {
  const fn = mockFetch(204);
  await adminApi.logout();
  await adminApi.deleteQuestion(3);
  const calls = fn.mock.calls as unknown as [string, RequestInit][];
  for (const [, init] of calls) expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  expect(calls[1]![0]).toBe('/api/admin/questions/3');
  expect(calls[1]![1].method).toBe('DELETE');
  expect(calls[0]![1].credentials).toBe('same-origin');
});

test('401 maps to { unauthorized: true }', async () => {
  mockFetch(401, { error: 'unauthorized' });
  expect(await adminApi.me()).toMatchObject({ ok: false, unauthorized: true });
});

test('503 admin_disabled maps to { disabled: true }', async () => {
  mockFetch(503, { error: 'admin_disabled' });
  expect(await adminApi.me()).toMatchObject({ ok: false, disabled: true });
});

test('success returns parsed JSON; errors carry error code and reason', async () => {
  mockFetch(200, { words: ['a'] });
  expect(await adminApi.getWords()).toEqual({ ok: true, data: { words: ['a'] } });
  mockFetch(400, { error: 'invalid', reason: 'la réponse est vide' });
  expect(await adminApi.createQuestion({ theme: 't', question: 'q', answer: '', variants: [] })).toMatchObject({
    ok: false, error: 'invalid', reason: 'la réponse est vide',
  });
});

test('network failure is an error result, not a throw', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  expect(await adminApi.me()).toMatchObject({ ok: false, error: 'network' });
});
