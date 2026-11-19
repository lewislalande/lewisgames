import { beforeEach, expect, test } from 'vitest';
import { DEFAULT_QUIZ_SETTINGS } from '@kg/shared';
import { hasSavedQuizSettings, loadQuizSettings, saveQuizSettings } from '../src/quiz/settingsStorage';

beforeEach(() => localStorage.clear());

test('nothing saved: defaults, and hasSaved is false', () => {
  expect(hasSavedQuizSettings()).toBe(false);
  expect(loadQuizSettings()).toEqual(DEFAULT_QUIZ_SETTINGS);
});

test('saving then loading round-trips under kg.quizSettings', () => {
  const s = { questionCount: 20, answerSeconds: 45, maxPlayers: 6, themes: ['Histoire', 'Cinéma'] };
  saveQuizSettings(s);
  expect(hasSavedQuizSettings()).toBe(true);
  expect(JSON.parse(localStorage.getItem('kg.quizSettings')!)).toEqual(s);
  expect(loadQuizSettings()).toEqual(s);
});

test('loading clamps out-of-range values through clampQuizSettings', () => {
  localStorage.setItem('kg.quizSettings', JSON.stringify({ questionCount: 500, answerSeconds: 1, maxPlayers: 7.6, themes: ['A', 'a', 3] }));
  expect(loadQuizSettings()).toEqual({ questionCount: 50, answerSeconds: 10, maxPlayers: 8, themes: ['A'] });
});

test('corrupted JSON gives the defaults', () => {
  localStorage.setItem('kg.quizSettings', '{not json');
  expect(loadQuizSettings()).toEqual(DEFAULT_QUIZ_SETTINGS);
  localStorage.setItem('kg.quizSettings', 'null');
  expect(loadQuizSettings()).toEqual(DEFAULT_QUIZ_SETTINGS);
});
