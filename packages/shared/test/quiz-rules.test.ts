import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUIZ_SETTINGS,
  QUIZ_RANGES,
  clampQuizSettings,
  groupAnswers,
  resolveVotes,
} from '../src';

describe('clampQuizSettings', () => {
  it('returns defaults for non-object input', () => {
    expect(clampQuizSettings(undefined)).toEqual(DEFAULT_QUIZ_SETTINGS);
    expect(clampQuizSettings('x')).toEqual(DEFAULT_QUIZ_SETTINGS);
    expect(DEFAULT_QUIZ_SETTINGS).toEqual({ questionCount: 15, answerSeconds: 30, maxPlayers: 8, themes: [] });
  });
  it('clamps and rounds numbers to ranges', () => {
    expect(QUIZ_RANGES).toEqual({ questionCount: [5, 50], answerSeconds: [10, 120], maxPlayers: [2, 12] });
    const s = clampQuizSettings({ questionCount: 999, answerSeconds: 1, maxPlayers: 5.6 });
    expect(s).toMatchObject({ questionCount: 50, answerSeconds: 10, maxPlayers: 6 });
  });
  it('ignores wrong types and unknown keys', () => {
    const s = clampQuizSettings({ questionCount: '20', answerSeconds: NaN, evil: 1 });
    expect(s).toEqual(DEFAULT_QUIZ_SETTINGS);
    expect('evil' in s).toBe(false);
  });
  it('cleans themes: trim, drop invalid, dedupe case-insensitively keeping first, max 40 chars, max 50', () => {
    const s = clampQuizSettings({ themes: ['  Histoire ', 'histoire', 'HISTOIRE', 3, '   ', 'Géo', 'x'.repeat(41), null] });
    expect(s.themes).toEqual(['Histoire', 'Géo']);
    const many = Array.from({ length: 80 }, (_, i) => `t${i}`);
    expect(clampQuizSettings({ themes: many }).themes).toHaveLength(50);
    expect(clampQuizSettings({ themes: 'nope' }).themes).toEqual([]);
  });
});

describe('groupAnswers', () => {
  it('groups by normalized text', () => {
    const g = groupAnswers({ A: 'Napoléon', B: 'napoleon ', C: 'Napoléon III', D: '  ' }, ['A', 'B', 'C', 'D']);
    expect(g).toHaveLength(2);
    expect(g[0]).toEqual({ id: 'napoleon', text: 'Napoléon', authors: ['A', 'B'] });
    expect(g[1].authors).toEqual(['C']);
  });
  it('orders groups by first author in order and uses that author spelling', () => {
    const g = groupAnswers({ A: 'Rome', B: 'paris', C: 'PARIS' }, ['C', 'B', 'A']);
    expect(g.map((x) => x.text)).toEqual(['PARIS', 'Rome']);
    expect(g[0].authors).toEqual(['C', 'B']);
  });
});

describe('resolveVotes', () => {
  it('picks strict majority', () => {
    expect(resolveVotes(['yes', 'yes', 'no'])).toBe('yes');
    expect(resolveVotes(['half', 'half', 'yes'])).toBe('half');
  });
  it('ties', () => {
    expect(resolveVotes(['yes', 'no'])).toBe('tie');
    expect(resolveVotes([])).toBe('tie');
  });
});
