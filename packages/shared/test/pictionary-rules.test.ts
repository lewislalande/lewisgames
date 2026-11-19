import { describe, it, expect } from 'vitest';
import { clampSettings, DEFAULT_SETTINGS, SETTING_RANGES } from '../src/pictionary/settings';
import { guesserPoints, drawerPoints } from '../src/pictionary/scoring';
import { maskWord, isLetterIndex, hintsUnlocked } from '../src/pictionary/hints';

describe('clampSettings', () => {
  it('defaults and clamps', () => {
    expect(clampSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(clampSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(clampSettings({ rounds: 99, drawSeconds: 5, maxHints: -1 })).toMatchObject({ rounds: 10, drawSeconds: 30, maxHints: 0 });
    expect(clampSettings({ rounds: 'x' }).rounds).toBe(3);
    expect(clampSettings({ rounds: 2.6 }).rounds).toBe(3);
    expect(clampSettings({ rounds: NaN }).rounds).toBe(3);
  });
  it('drops unknown keys and handles invalid enums/booleans', () => {
    expect(clampSettings({ evil: 1 })).not.toHaveProperty('evil');
    expect(clampSettings({ customWordsMode: 'zzz' }).customWordsMode).toBe('mixed');
    expect(clampSettings({ customWordsMode: 'only' }).customWordsMode).toBe('only');
    expect(clampSettings({ closeDetection: 'no' }).closeDetection).toBe(true);
    expect(clampSettings({ closeDetection: false }).closeDetection).toBe(false);
  });
  it('cleans custom words', () => {
    expect(clampSettings({ customWords: [' chat ', 'chat', '', 'chien'] }).customWords).toEqual(['chat', 'chien']);
    expect(clampSettings({ customWords: ['a'.repeat(31), 'ok', 5] }).customWords).toEqual(['ok']);
    expect(clampSettings({ customWords: 'chat' }).customWords).toEqual([]);
    const many = Array.from({ length: 600 }, (_, i) => `mot${i}`);
    expect(clampSettings({ customWords: many }).customWords).toHaveLength(500);
  });
  it('normalizes custom words to NFC and dedupes ignoring case and accents', () => {
    const decomposed = 'e\u0301le\u0301phant';
    const out = clampSettings({ customWords: [decomposed, 'Éléphant', 'elephant', 'ELEPHANT', 'Arc-en-ciel', 'arc en ciel', 'chat'] }).customWords;
    expect(out).toEqual(['éléphant', 'Arc-en-ciel', 'chat']);
    expect(out[0]).toBe('éléphant'.normalize('NFC'));
    expect(clampSettings({ customWords: ['---', 'ok'] }).customWords).toEqual(['ok']);
  });
  it('exposes numeric ranges', () => {
    expect(SETTING_RANGES.maxPlayers).toEqual([2, 12]);
  });
});

describe('scoring', () => {
  it('guesserPoints', () => {
    expect(guesserPoints(0, 80000, false)).toBe(100);
    expect(guesserPoints(80000, 80000, false)).toBe(20);
    expect(guesserPoints(99999, 80000, false)).toBe(20);
    expect(guesserPoints(40000, 80000, true)).toBe(70);
    // Clock skew: a negative elapsed time counts as 0.
    expect(guesserPoints(-5000, 80000, false)).toBe(100);
    expect(guesserPoints(-5000, 80000, true)).toBe(110);
  });
  it('drawerPoints', () => {
    expect(drawerPoints(3, 3)).toBe(100);
    expect(drawerPoints(1, 3)).toBe(33);
    expect(drawerPoints(0, 0)).toBe(0);
    expect(drawerPoints(4, 3)).toBe(100);
    expect(drawerPoints(-1, 3)).toBe(0);
  });
});

describe('hints', () => {
  it('maskWord', () => {
    expect(maskWord('arc-en ciel', [])).toEqual(['_', '_', '_', '-', '_', '_', ' ', '_', '_', '_', '_']);
    expect(maskWord('chat', [2])).toEqual(['_', '_', 'a', '_']);
    expect(maskWord("l'ami’s", [])).toEqual(['_', "'", '_', '_', '_', '’', '_']);
  });
  it('isLetterIndex', () => {
    expect(isLetterIndex('arc-en', 3)).toBe(false);
    expect(isLetterIndex('arc-en', 2)).toBe(true);
    expect(isLetterIndex('arc', 9)).toBe(false);
  });
  it('hintsUnlocked', () => {
    expect(hintsUnlocked(53000, 80000, 67)).toBe(false);
    expect(hintsUnlocked(53600, 80000, 67)).toBe(true);
    expect(hintsUnlocked(0, 80000, 0)).toBe(true);
  });
});
