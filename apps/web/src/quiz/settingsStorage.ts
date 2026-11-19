import { clampQuizSettings, type QuizSettings } from '@kg/shared';

const KEY = 'kg.quizSettings';

export function hasSavedQuizSettings(): boolean {
  return localStorage.getItem(KEY) !== null;
}

/** The host's saved settings, clamped; the defaults when nothing (or garbage) is saved. */
export function loadQuizSettings(): QuizSettings {
  try {
    return clampQuizSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return clampQuizSettings(null);
  }
}

export function saveQuizSettings(s: QuizSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
