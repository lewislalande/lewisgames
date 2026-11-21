import { normalize } from '../text';

export type PictionarySettings = {
  rounds: number;
  drawSeconds: number;
  chooseSeconds: number;
  wordChoices: number;
  maxHints: number;
  hintUnlockPct: number;
  closeDetection: boolean;
  maxPlayers: number;
  customWords: string[];
  customWordsMode: 'mixed' | 'only';
  mode: 'classique' | 'imposteur';
  /** Imposter mode: number of manches. */
  impRounds: number;
  /** Imposter mode: strokes per player in a manche. */
  impTableRounds: number;
  impStrokeSeconds: number;
  /** 0: straight to the vote. */
  impDiscussSeconds: number;
  /** Start each manche's drawing with a random grey curve. */
  impScribble: boolean;
};

export type NumericSettingKey =
  | 'rounds' | 'drawSeconds' | 'chooseSeconds' | 'wordChoices'
  | 'maxHints' | 'hintUnlockPct' | 'maxPlayers'
  | 'impRounds' | 'impTableRounds' | 'impStrokeSeconds' | 'impDiscussSeconds';

export const DEFAULT_SETTINGS: PictionarySettings = {
  rounds: 3,
  drawSeconds: 80,
  chooseSeconds: 15,
  wordChoices: 3,
  maxHints: 2,
  hintUnlockPct: 67,
  closeDetection: true,
  maxPlayers: 8,
  customWords: [],
  customWordsMode: 'mixed',
  mode: 'classique',
  impRounds: 3,
  impTableRounds: 2,
  impStrokeSeconds: 20,
  impDiscussSeconds: 60,
  impScribble: true,
};

export const SETTING_RANGES: Record<NumericSettingKey, [number, number]> = {
  rounds: [1, 10],
  drawSeconds: [30, 240],
  chooseSeconds: [5, 30],
  wordChoices: [1, 5],
  maxHints: [0, 5],
  hintUnlockPct: [0, 100],
  maxPlayers: [2, 12],
  impRounds: [1, 10],
  impTableRounds: [1, 4],
  impStrokeSeconds: [10, 60],
  impDiscussSeconds: [0, 180],
};

const MAX_CUSTOM_WORDS = 500;
const MAX_WORD_LENGTH = 30;

function cleanWords(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of v) {
    if (typeof w !== 'string') continue;
    const t = w.normalize('NFC').trim();
    if (!t || t.length > MAX_WORD_LENGTH) continue;
    // Same key as guess matching: "Éléphant" and "elephant" are one word (first spelling kept).
    const key = normalize(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_CUSTOM_WORDS) break;
  }
  return out;
}

export function clampSettings(input: unknown): PictionarySettings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: PictionarySettings = { ...DEFAULT_SETTINGS, customWords: [] };
  for (const key of Object.keys(SETTING_RANGES) as NumericSettingKey[]) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = SETTING_RANGES[key];
      out[key] = Math.min(max, Math.max(min, Math.round(v)));
    }
  }
  if (typeof src.closeDetection === 'boolean') out.closeDetection = src.closeDetection;
  out.customWordsMode = src.customWordsMode === 'only' ? 'only' : 'mixed';
  out.mode = src.mode === 'imposteur' ? 'imposteur' : 'classique';
  if (typeof src.impScribble === 'boolean') out.impScribble = src.impScribble;
  out.customWords = cleanWords(src.customWords);
  return out;
}
