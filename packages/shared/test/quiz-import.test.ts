import { describe, it, expect } from 'vitest';
import { parseImport, questionKey } from '../src/quiz/import';

const q = (over: Record<string, unknown> = {}) => ({
  theme: 'Cinéma', question: 'Qui a réalisé Jaws ?', answer: 'Spielberg', variants: ['Steven Spielberg'], ...over,
});

describe('parseImport', () => {
  it('accepts the documented format and trims every field', () => {
    const r = parseImport({
      questions: [
        q({ theme: '  Cinéma ', question: ' Qui a réalisé Jaws ?  ', answer: ' Spielberg ', variants: [' Steven Spielberg ', '  '] }),
        q({ theme: 'Sport', question: 'Combien de joueurs au rugby à XV ?', answer: '15', variants: [] }),
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toEqual([
      { theme: 'Cinéma', question: 'Qui a réalisé Jaws ?', answer: 'Spielberg', variants: ['Steven Spielberg'] },
      { theme: 'Sport', question: 'Combien de joueurs au rugby à XV ?', answer: '15', variants: [] },
    ]);
  });

  it('treats missing variants as none', () => {
    const { theme, question, answer } = q();
    expect(parseImport({ questions: [{ theme, question, answer }] }).ok[0]!.variants).toEqual([]);
  });

  it('rejects over-limit and missing fields with the index and a reason, keeping the valid ones', () => {
    const r = parseImport({
      questions: [
        q(),
        q({ theme: 'x'.repeat(41) }),
        q({ question: 'x'.repeat(301) }),
        q({ answer: 'x'.repeat(101) }),
        q({ variants: Array.from({ length: 11 }, (_, i) => `v${i}`) }),
        q({ variants: ['x'.repeat(101)] }),
        q({ answer: '   ' }),
        q({ theme: 3 }),
        q({ variants: 'nope' }),
        'not an object',
      ],
    });
    expect(r.ok).toHaveLength(1);
    expect(r.errors.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const e of r.errors) expect(e.reason).toMatch(/\S/);
  });

  it('accepts fields exactly at the limits', () => {
    const r = parseImport({
      questions: [q({
        theme: 't'.repeat(40), question: 'q'.repeat(300), answer: 'a'.repeat(100),
        variants: Array.from({ length: 10 }, () => 'v'.repeat(100)),
      })],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toHaveLength(1);
  });

  it('reports a malformed document as a single error', () => {
    for (const doc of [null, [], 'x', {}, { questions: 'x' }]) {
      const r = parseImport(doc);
      expect(r.ok).toEqual([]);
      expect(r.errors).toHaveLength(1);
    }
  });
});

describe('questionKey', () => {
  it('ignores case, accents and spacing', () => {
    expect(questionKey('  Qui a réalisé   JAWS ? ')).toBe(questionKey('qui a realise jaws ?'));
    expect(questionKey('Paris')).not.toBe(questionKey('Lyon'));
  });
});
