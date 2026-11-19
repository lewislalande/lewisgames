import { describe, it, expect } from 'vitest';
import { parseImport, questionKey } from '../src/quiz/import';
// @ts-expect-error plain JS module without types
import * as seed from '../../../apps/worker/scripts/seed-lib.mjs';

import file from '../../../apps/worker/seed/questions-fr.json';
const THEMES = ['Géographie', 'Histoire', 'Sciences', 'Nature & animaux', 'Cinéma & séries', 'Musique', 'Sport', 'Jeux vidéo', 'Littérature & BD', 'Cuisine & gastronomie'];

describe('seed question file', () => {
  const { ok, errors } = parseImport(file);
  it('is valid: 200 questions, unique keys, 20 per theme', () => {
    expect(errors).toEqual([]);
    expect(ok).toHaveLength(200);
    expect(new Set(ok.map((q) => questionKey(q.question))).size).toBe(200);
    for (const t of THEMES) expect(ok.filter((q) => q.theme === t)).toHaveLength(20);
    expect(new Set(ok.map((q) => q.theme)).size).toBe(10);
  });

  it('seed-lib computes the same keys and validation as the shared code', () => {
    for (const q of ok) expect(seed.questionKey(q.question)).toBe(questionKey(q.question));
    expect(seed.parseImport(file)).toEqual({ ok, errors });
    const bad = { questions: [{ theme: '', question: 'a', answer: 'b' }, 3, { theme: 'x', question: 'y'.repeat(301), answer: 'b' }] };
    expect(seed.parseImport(bad)).toEqual(parseImport(bad));
    for (const s of ["L'été ? Oui !", 'Qui a écrit « Les Misérables » ?', 'Œuvre  d’art — où ?'])
      expect(seed.questionKey(s)).toBe(questionKey(s));
  });
});

describe('buildSql', () => {
  it('escapes quotes, skips invalid entries and keeps INSERT OR IGNORE', () => {
    const r = seed.buildSql({
      questions: { questions: [
        { theme: 'T', question: "Qu'est-ce que l'O'Brien ?", answer: "L'eau", variants: ["l'H2O"] },
        { theme: 'T', question: '', answer: 'x' },
      ] },
      words: ["l'arbre", "l'arbre", 'chat'],
      now: 1000,
    });
    expect(r.questionCount).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.wordCount).toBe(2);
    expect(r.sql).toContain("'Qu''est-ce que l''O''Brien ?'");
    expect(r.sql).toContain(`'["l''H2O"]'`);
    expect(r.sql).toContain("'généré', 1000);");
    expect(r.sql).toContain("INSERT OR IGNORE INTO words (word) VALUES ('l''arbre');");
    expect(r.sql.match(/INSERT OR IGNORE/g)).toHaveLength(3);
    expect(r.sql).not.toMatch(/INSERT INTO/);
  });
});
