import { describe, it, expect } from 'vitest';
import { normalize, classifyGuess, levenshtein } from '../src/text';

describe('normalize', () => {
  it('handles case, hyphens, whitespace', () => {
    expect(normalize('  ARC-en  Ciel ')).toBe('arc en ciel');
  });
  it('strips accents', () => {
    expect(normalize('Éléphant')).toBe('elephant');
  });
  it('handles ligatures and apostrophes', () => {
    expect(normalize('L’œuf')).toBe('l oeuf');
  });
});

describe('levenshtein', () => {
  it('computes distances', () => {
    expect(levenshtein('chat', 'chat')).toBe(0);
    expect(levenshtein('chat', 'chot')).toBe(1);
    expect(levenshtein('chta', 'chat')).toBe(2);
    expect(levenshtein('', 'chat')).toBe(4);
  });
});

describe('classifyGuess', () => {
  it('correct', () => {
    expect(classifyGuess('ARC EN  ciel', 'arc-en-ciel', true)).toBe('correct');
    expect(classifyGuess('elephant', 'éléphant', true)).toBe('correct');
  });
  it('close / wrong', () => {
    expect(classifyGuess('chta', 'chat', true)).toBe('wrong');
    expect(classifyGuess('chot', 'chat', true)).toBe('close');
    expect(classifyGuess('chien', 'chat', true)).toBe('wrong');
    expect(classifyGuess('telephonne', 'téléphone', true)).toBe('close');
    expect(classifyGuess('tlephonne', 'téléphone', true)).toBe('close');
    expect(classifyGuess('chot', 'chat', false)).toBe('wrong');
    expect(classifyGuess('', 'chat', true)).toBe('wrong');
  });
});
