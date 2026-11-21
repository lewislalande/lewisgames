import { describe, expect, it } from 'vitest';
import type { ImposterView, PictionaryView, QuizView } from '@kg/shared';
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

describe('pictionarySound, imposter mode', () => {
  const imp = (p: Partial<ImposterView> = {}) => ({ myVote: null, result: null, ...p }) as ImposterView;
  const iv = (p: Partial<PictionaryView>) => pv({ phase: 'impDrawing', isDrawer: false, imp: imp(), ...p });
  it('own turn → turnStart; someone else turn → none', () => {
    expect(pictionarySound(iv({ phase: 'impReveal' }), iv({ isDrawer: true }))).toBe('turnStart');
    expect(pictionarySound(iv({}), iv({ isDrawer: true }))).toBe('turnStart');
    expect(pictionarySound(iv({ isDrawer: true }), iv({}))).toBeNull();
    expect(pictionarySound(iv({ phase: 'impReveal' }), iv({}))).toBeNull();
  });
  it('vote opens → reveal; own vote → submit; others vote → none', () => {
    expect(pictionarySound(iv({ phase: 'impDiscuss' }), iv({ phase: 'impVote' }))).toBe('reveal');
    expect(pictionarySound(iv({ phase: 'impVote' }), iv({ phase: 'impVote', imp: imp({ myVote: 'bob' }) }))).toBe('submit');
    expect(pictionarySound(iv({ phase: 'impVote', imp: imp({ myVote: 'bob' }) }), iv({ phase: 'impVote', imp: imp({ myVote: 'bob' }) }))).toBeNull();
  });
  it('result: imposter caught → found; imposter won → timeUp; game over → podium', () => {
    const result = (imposterWon: boolean) => imp({ result: { imposterId: 'x', accused: 'x', guess: null, imposterWon, votes: {} } });
    expect(pictionarySound(iv({ phase: 'impVote' }), iv({ phase: 'impResult', imp: result(false) }))).toBe('found');
    expect(pictionarySound(iv({ phase: 'impGuess' }), iv({ phase: 'impResult', imp: result(true) }))).toBe('timeUp');
    expect(pictionarySound(iv({ phase: 'impResult' }), pv({ phase: 'gameOver', imp: null }))).toBe('podium');
  });
});
