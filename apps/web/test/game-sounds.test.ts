import { describe, expect, it } from 'vitest';
import type { PictionaryView, QuizView } from '@kg/shared';
import { pictionarySound, quizSound } from '../src/room/gameSounds';

const q = (p: Partial<QuizView>) => ({ phase: 'answering', questionNumber: 1, answered: [], phaseEndsAt: 10_000, serverNow: 5_000, ...p }) as QuizView;
const pv = (p: Partial<PictionaryView>) => ({ phase: 'drawing', found: [], phaseEndsAt: 10_000, serverNow: 5_000, ...p }) as PictionaryView;

describe('quizSound', () => {
  it('own submit → submit; someone else → reveal; nothing new → none', () => {
    expect(quizSound(q({}), q({ answered: ['me'] }), 'me')).toBe('submit');
    expect(quizSound(q({ answered: ['me'] }), q({ answered: ['me', 'bob'] }), 'me')).toBe('reveal');
    expect(quizSound(q({ answered: ['bob'] }), q({ answered: ['bob'] }), 'me')).toBeNull();
    expect(quizSound(q({ answered: ['bob'] }), q({ answered: [] }), 'me')).toBeNull(); // withdrawn
  });
  it('a new question is not a submission', () => {
    expect(quizSound(q({ answered: [] }), q({ questionNumber: 2, answered: ['bob'] }), 'me')).toBeNull();
  });
  it('answering ended at the deadline → timeUp', () => {
    expect(quizSound(q({}), q({ phase: 'transition', serverNow: 9_800 }), 'me')).toBe('timeUp');
    expect(quizSound(q({}), q({ phase: 'voting', serverNow: 10_050 }), 'me')).toBe('timeUp');
  });
  it('answering ended early: the last submitter gets submit, the others reveal', () => {
    expect(quizSound(q({ answered: ['bob'] }), q({ phase: 'transition', serverNow: 6_000 }), 'me')).toBe('submit');
    expect(quizSound(q({ answered: ['me'] }), q({ phase: 'transition', serverNow: 6_000 }), 'me')).toBe('reveal');
  });
  it('game over → podium; review phases → none', () => {
    expect(quizSound(q({ phase: 'result' }), q({ phase: 'gameOver' }), 'me')).toBe('podium');
    expect(quizSound(q({ phase: 'voting' }), q({ phase: 'deciding' }), 'me')).toBeNull();
    expect(quizSound(q({ phase: 'transition' }), q({ phase: 'answering' }), 'me')).toBeNull();
  });
});

describe('pictionarySound', () => {
  it('turn start, find, time up, podium', () => {
    expect(pictionarySound(pv({ phase: 'choosing' }), pv({}))).toBe('turnStart');
    expect(pictionarySound(pv({}), pv({ found: ['bob'] }))).toBe('found');
    expect(pictionarySound(pv({ found: ['bob'] }), pv({ phase: 'turnEnd', found: ['bob', 'carol'], serverNow: 6_000 }))).toBe('found');
    expect(pictionarySound(pv({}), pv({ phase: 'turnEnd', serverNow: 10_000 }))).toBe('timeUp');
    expect(pictionarySound(pv({ phase: 'turnEnd' }), pv({ phase: 'gameOver' }))).toBe('podium');
  });
  it('quiet otherwise', () => {
    expect(pictionarySound(pv({}), pv({}))).toBeNull();
    expect(pictionarySound(pv({}), pv({ phase: 'turnEnd', serverNow: 6_000 }))).toBeNull(); // drawer left
    expect(pictionarySound(pv({ phase: 'turnEnd' }), pv({ phase: 'choosing' }))).toBeNull();
    expect(pictionarySound(pv({ phase: 'lobby' }), pv({ phase: 'choosing' }))).toBeNull();
  });
});
