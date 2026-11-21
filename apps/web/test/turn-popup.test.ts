import { describe, expect, it } from 'vitest';
import type { ImposterView, PictionaryView } from '@kg/shared';
import { turnPopup } from '../src/room/turnPopup';

const imp = (p: Partial<ImposterView> = {}) =>
  ({ manche: 1, tableRound: 1, currentDrawer: 'bob', colors: { me: '#f00', bob: '#00f' }, ...p }) as ImposterView;
const iv = (p: Partial<PictionaryView> = {}, i: Partial<ImposterView> = {}) =>
  ({ phase: 'impDrawing', isDrawer: false, imp: imp(i), word: null, ...p }) as PictionaryView;
const cv = (p: Partial<PictionaryView>) => ({ phase: 'choosing', isDrawer: false, imp: null, word: null, ...p }) as PictionaryView;

describe('turnPopup, imposter', () => {
  it('fires once when the turn becomes mine, with my colour', () => {
    const p = turnPopup(iv(), iv({ isDrawer: true }, { currentDrawer: 'me' }), 'me');
    expect(p).toMatchObject({ title: 'À toi de jouer !', sub: 'Un seul trait, dans ta couleur', color: '#f00' });
  });
  it('not for others, not for unrelated updates within my own turn', () => {
    expect(turnPopup(iv({ phase: 'impReveal' }), iv(), 'me')).toBeNull();
    const mine = iv({ isDrawer: true }, { currentDrawer: 'me' });
    expect(turnPopup(mine, { ...mine }, 'me')).toBeNull();
    expect(turnPopup(mine, iv({ isDrawer: true }, { currentDrawer: 'me', colors: { me: '#f00' } }), 'me')).toBeNull();
  });
  it('fires again for a new turn of mine (next tour de table), not when I only lost the pen', () => {
    const a = iv({}, { currentDrawer: 'me' });
    expect(turnPopup(a, iv({}, { currentDrawer: 'me', tableRound: 2 }), 'me')).not.toBeNull();
    expect(turnPopup(a, iv({}, { currentDrawer: 'bob' }), 'me')).toBeNull();
    expect(turnPopup(iv({ phase: 'impDiscuss' }, { currentDrawer: 'me' }), iv({ phase: 'impVote' }, { currentDrawer: 'me' }), 'me')).toBeNull();
  });
  it('nothing without a colour or a player id', () => {
    const b = iv({}, { currentDrawer: 'me', colors: {} });
    expect(turnPopup(iv(), b, 'me')).toBeNull();
    expect(turnPopup(iv(), iv({}, { currentDrawer: 'me' }), null)).toBeNull();
  });
});

describe('turnPopup, Classique', () => {
  it('drawer gets the word when drawing starts; guessers and later updates get nothing', () => {
    const drawing = cv({ phase: 'drawing', isDrawer: true, word: 'chat' });
    expect(turnPopup(cv({ isDrawer: true }), drawing, 'me')).toMatchObject({ title: 'À toi de dessiner !', sub: 'chat' });
    expect(turnPopup(drawing, { ...drawing }, 'me')).toBeNull();
    expect(turnPopup(cv({}), cv({ phase: 'drawing', word: null }), 'me')).toBeNull();
  });
});
