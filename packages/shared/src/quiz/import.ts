import { normalize } from '../text';
import type { Question } from './game';

export type ImportedQuestion = Omit<Question, 'id'>;
export type ImportError = { index: number; reason: string };

export const IMPORT_LIMITS = { theme: 40, question: 300, answer: 100, variants: 10, variant: 100 } as const;

/**
 * Dedupe key of a question: two questions differing only by case, accents, punctuation or spacing
 * are the same ("Quelle est X ?" = "Quelle est X?" = "quelle est x").
 */
export function questionKey(q: string): string {
  return normalize(q).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const LABELS = { theme: 'le thème', question: 'la question', answer: 'la réponse' } as const;

function requiredText(src: Record<string, unknown>, key: keyof typeof LABELS): string {
  const v = src[key];
  if (typeof v !== 'string') throw new Error(`${LABELS[key]} doit être un texte`);
  const s = v.normalize('NFC').trim();
  if (!s) throw new Error(`${LABELS[key]} est vide`);
  if (s.length > IMPORT_LIMITS[key]) throw new Error(`${LABELS[key]} dépasse ${IMPORT_LIMITS[key]} caractères`);
  return s;
}

function variantsOf(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error('les variantes doivent être une liste de textes');
  const out = (v as string[]).map((x) => x.normalize('NFC').trim()).filter((x) => x.length > 0);
  if (out.length > IMPORT_LIMITS.variants) throw new Error(`plus de ${IMPORT_LIMITS.variants} variantes`);
  if (out.some((x) => x.length > IMPORT_LIMITS.variant)) throw new Error(`une variante dépasse ${IMPORT_LIMITS.variant} caractères`);
  return out;
}

/**
 * Validates an import document `{"questions":[{theme, question, answer, variants}]}`: every text is
 * trimmed, invalid entries are reported by index (0-based) and skipped. Duplicates are not checked
 * here (the database's `question_key` does it).
 */
export function parseImport(json: unknown): { ok: ImportedQuestion[]; errors: ImportError[] } {
  if (!isObject(json) || !Array.isArray(json.questions)) {
    return { ok: [], errors: [{ index: -1, reason: 'le fichier doit contenir {"questions": [...]}' }] };
  }
  const ok: ImportedQuestion[] = [];
  const errors: ImportError[] = [];
  json.questions.forEach((item: unknown, index: number) => {
    if (!isObject(item)) {
      errors.push({ index, reason: 'la question doit être un objet' });
      return;
    }
    try {
      ok.push({
        theme: requiredText(item, 'theme'),
        question: requiredText(item, 'question'),
        answer: requiredText(item, 'answer'),
        variants: variantsOf(item.variants),
      });
    } catch (err) {
      errors.push({ index, reason: (err as Error).message });
    }
  });
  return { ok, errors };
}
