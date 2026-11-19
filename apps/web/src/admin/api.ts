import type { ImportedQuestion, ImportError } from '@kg/shared';

export type QuestionItem = ImportedQuestion & {
  id: number; source: string; createdAt: number; lastUsedAt: number | null;
};
export type QuestionPage = { items: QuestionItem[]; total: number; page: number; pageSize: number };
export type ImportReport = { inserted: number; duplicates: number; errors: ImportError[] };
export type ThemeCount = { theme: string; count: number };

export type Fail = { ok: false; error: string; reason?: string; unauthorized?: true; disabled?: true };
export type Result<T> = { ok: true; data: T } | Fail;

async function request<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  try {
    const init: RequestInit = { method, credentials: 'same-origin' };
    // The API refuses non-GET requests that are not application/json.
    if (method !== 'GET') {
      init.headers = { 'content-type': 'application/json' };
      if (body !== undefined) init.body = JSON.stringify(body);
    }
    const res = await fetch(path, init);
    const text = res.status === 204 ? '' : await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (res.ok) return { ok: true, data: json as T };
    const { error, reason } = (json ?? {}) as { error?: string; reason?: string };
    if (res.status === 401) return { ok: false, unauthorized: true, error: 'unauthorized' };
    if (res.status === 503 && error === 'admin_disabled') return { ok: false, disabled: true, error };
    return { ok: false, error: error ?? `http_${res.status}`, reason };
  } catch {
    return { ok: false, error: 'network' };
  }
}

const qs = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== 0).map(([k, v]) => [k, String(v)])).toString();

export const adminApi = {
  me: () => request<null>('GET', '/api/admin/me'),
  login: (password: string) => request<null>('POST', '/api/admin/login', { password }),
  logout: () => request<null>('POST', '/api/admin/logout'),
  themes: () => request<ThemeCount[]>('GET', '/api/themes'),
  listQuestions: (p: { theme: string; q: string; page: number }) =>
    request<QuestionPage>('GET', `/api/admin/questions?${qs(p)}`),
  createQuestion: (q: ImportedQuestion) => request<{ id: number }>('POST', '/api/admin/questions', q),
  updateQuestion: (id: number, q: ImportedQuestion) => request<{ id: number }>('PUT', `/api/admin/questions/${id}`, q),
  deleteQuestion: (id: number) => request<null>('DELETE', `/api/admin/questions/${id}`),
  importQuestions: (questions: ImportedQuestion[]) => request<ImportReport>('POST', '/api/admin/import', { questions }),
  exportQuestions: () => request<{ questions: ImportedQuestion[] }>('GET', '/api/admin/export'),
  getWords: () => request<{ words: string[] }>('GET', '/api/admin/words'),
  putWords: (words: string[]) => request<{ count: number }>('PUT', '/api/admin/words', { words }),
};
