import type { Question } from '@kg/shared';

type QuestionRow = { id: number; theme: string; question: string; answer: string; variants: string };

function parseVariants(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

/**
 * Up to `n` questions from `themes` (empty: every theme): never-used ones first, then the least
 * recently used, ties broken at random.
 */
export async function pickQuestions(db: D1Database, themes: string[], n: number): Promise<Question[]> {
  const where = themes.length > 0 ? `WHERE theme IN (${placeholders(themes.length)})` : '';
  const { results } = await db
    .prepare(
      `SELECT id, theme, question, answer, variants FROM questions ${where}
       ORDER BY last_used_at IS NULL DESC, last_used_at ASC, random() LIMIT ?`,
    )
    .bind(...themes, n)
    .all<QuestionRow>();
  return results.map((r) => ({ id: r.id, theme: r.theme, question: r.question, answer: r.answer, variants: parseVariants(r.variants) }));
}

export async function markUsed(db: D1Database, ids: number[], now: number): Promise<void> {
  if (ids.length === 0) return;
  await db.prepare(`UPDATE questions SET last_used_at = ? WHERE id IN (${placeholders(ids.length)})`).bind(now, ...ids).run();
}

export async function listThemes(db: D1Database): Promise<{ theme: string; count: number }[]> {
  const { results } = await db
    .prepare('SELECT theme, COUNT(*) AS count FROM questions GROUP BY theme ORDER BY theme')
    .all<{ theme: string; count: number }>();
  return results;
}

export async function loadWords(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare('SELECT word FROM words').all<{ word: string }>();
  return results.map((r) => r.word);
}
