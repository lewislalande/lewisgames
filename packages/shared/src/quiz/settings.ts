import { normalize } from '../text';

export type QuizSettings = {
  questionCount: number;
  answerSeconds: number;
  maxPlayers: number;
  themes: string[];
};

export type QuizNumericKey = 'questionCount' | 'answerSeconds' | 'maxPlayers';

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  questionCount: 15,
  answerSeconds: 30,
  maxPlayers: 8,
  themes: [],
};

export const QUIZ_RANGES: Record<QuizNumericKey, [number, number]> = {
  questionCount: [5, 50],
  answerSeconds: [10, 120],
  maxPlayers: [2, 12],
};

const MAX_THEMES = 50;
const MAX_THEME_LENGTH = 40;

function cleanThemes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== 'string') continue;
    const s = t.normalize('NFC').trim();
    if (!s || s.length > MAX_THEME_LENGTH) continue;
    // Case/accent-insensitive dedupe, first spelling kept.
    const key = normalize(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_THEMES) break;
  }
  return out;
}

export function clampQuizSettings(input: unknown): QuizSettings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: QuizSettings = { ...DEFAULT_QUIZ_SETTINGS, themes: [] };
  for (const key of Object.keys(QUIZ_RANGES) as QuizNumericKey[]) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = QUIZ_RANGES[key];
      out[key] = Math.min(max, Math.max(min, Math.round(v)));
    }
  }
  out.themes = cleanThemes(src.themes);
  return out;
}
