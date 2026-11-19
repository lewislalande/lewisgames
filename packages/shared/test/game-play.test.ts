import { describe, it, expect } from 'vitest';
import {
  reduce, initialState, TURN_END_MS, type Ctx, type DrawOp, type GameEvent, type PictionaryState,
} from '../src/pictionary/game';
import { viewFor } from '../src/pictionary/view';
import { MAX_STROKE_POINTS, type DrawAction } from '../src/pictionary/drawing';
import { disconnect, type Room } from '../src/room';
import words from '../src/pictionary/words-fr.json';

const mkRoom = (): Room => ({
  code: 'ABCDE', game: 'pictionary', hostId: 'A', tokens: {},
  players: ['A', 'B', 'C'].map((id, i) => ({ id, name: `Nom${id}`, connected: true, joinedAt: i })),
});

function seeded(seed = 1) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

const mkCtx = (room: Room, now = 1000): Ctx => ({ now, rng: seeded(), room, words });
const run = (s: PictionaryState, ev: GameEvent, ctx: Ctx) => reduce(s, ev, ctx).state;

/** Drawing phase: A draws, word chosen at t=2000, drawSeconds 80, maxHints 2. */
function drawing(room = mkRoom(), word = 'chat'): PictionaryState {
  let s = run(initialState(), { type: 'start', by: 'A' }, mkCtx(room));
  s = run(s, { type: 'chooseWord', by: 'A', index: 0 }, mkCtx(room, 2000));
  return { ...s, word };
}

const stroke = (id = 's1', points: [number, number][] = [[1, 2]]): DrawAction => ({
  id, kind: 'stroke', tool: 'pen', color: '#000000', size: 4, opacity: 1, points,
});

describe('guessing', () => {
  it('correct guess scores, announces without the word, notifies privately', () => {
    const room = mkRoom();
    const s = drawing(room);
    const r = reduce(s, { type: 'guess', by: 'B', text: ' CHAT ' }, mkCtx(room, 12000));
    expect(r.state.found.map((f) => f.playerId)).toEqual(['B']);
    expect(r.state.scores.B).toBeGreaterThan(0);
    expect(r.state.turnPoints.B).toBe(r.state.scores.B);
    expect(r.state.chat.at(-1)).toMatchObject({ kind: 'system', text: 'NomB a trouvé !' });
    expect(r.state.chat.some((c) => c.text.includes('chat'))).toBe(false);
    expect(r.effects).toEqual([{ type: 'state' }, { type: 'private', to: 'B', notice: 'correct' }]);
    expect(r.state.phase).toBe('drawing');
  });
  it('first finder gets a bonus', () => {
    const room = mkRoom();
    const s = drawing(room);
    const b = run(s, { type: 'guess', by: 'B', text: 'chat' }, mkCtx(room, 12000));
    const c = run(b, { type: 'guess', by: 'C', text: 'chat' }, mkCtx(room, 12000));
    expect(c.phase).toBe('turnEnd');
    expect(b.scores.B - 10).toBe(c.scores.C);
  });
  it('close guess: private notice only, no chat', () => {
    const room = mkRoom();
    const s = drawing(room);
    const r = reduce(s, { type: 'guess', by: 'B', text: 'chats' }, mkCtx(room, 3000));
    expect(r.effects).toEqual([{ type: 'private', to: 'B', notice: 'close' }]);
    expect(r.state.chat).toEqual(s.chat);
    expect(r.state.found).toEqual([]);
  });
  it('wrong guess appears in chat', () => {
    const room = mkRoom();
    const r = reduce(drawing(room), { type: 'guess', by: 'B', text: 'voiture' }, mkCtx(room, 3000));
    expect(r.state.chat.at(-1)).toMatchObject({ kind: 'guess', playerId: 'B', text: 'voiture' });
    expect(r.effects).toEqual([{ type: 'state' }]);
  });
  it.each([true, false])('guess embedding the word is never broadcast (closeDetection %s)', (closeDetection) => {
    const room = mkRoom();
    const s0 = drawing(room);
    const s = { ...s0, settings: { ...s0.settings, closeDetection } };
    for (const text of ['le chat', 'chat chat', "c'est un chat", 'Le CHAT!']) {
      const r = reduce(s, { type: 'guess', by: 'B', text }, mkCtx(room, 3000));
      // With closeDetection off the guess is dropped silently: no chat line, no « tu chauffes ! ».
      expect(r.effects).toEqual(closeDetection ? [{ type: 'private', to: 'B', notice: 'close' }] : []);
      expect(r.state).toBe(s);
    }
    const ok = reduce(s, { type: 'guess', by: 'B', text: 'chateau' }, mkCtx(room, 3000));
    expect(ok.state.chat.at(-1)?.text).toBe('chateau');
  });
  it('finder guesses are ignored', () => {
    const room = mkRoom();
    const b = run(drawing(room), { type: 'guess', by: 'B', text: 'chat' }, mkCtx(room, 3000));
    const r = reduce(b, { type: 'guess', by: 'B', text: 'bonjour' }, mkCtx(room, 4000));
    expect(r.state).toBe(b);
    expect(r.effects).toEqual([]);
  });
  it('drawer, empty, too long, or out-of-phase guesses are ignored', () => {
    const room = mkRoom();
    const s = drawing(room);
    const ctx = mkCtx(room, 3000);
    expect(run(s, { type: 'guess', by: 'A', text: 'chat' }, ctx)).toBe(s);
    expect(run(s, { type: 'guess', by: 'B', text: '   ' }, ctx)).toBe(s);
    expect(run(s, { type: 'guess', by: 'B', text: 'x'.repeat(101) }, ctx)).toBe(s);
    const choosing = run(initialState(), { type: 'start', by: 'A' }, mkCtx(room));
    expect(run(choosing, { type: 'guess', by: 'B', text: 'chat' }, ctx)).toBe(choosing);
  });
  it('all connected guessers found ends the turn; disconnected ones do not block', () => {
    let room = mkRoom();
    const s = drawing(room);
    room = disconnect(room, 'C');
    const e = run(s, { type: 'guess', by: 'B', text: 'chat' }, mkCtx(room, 3000));
    expect(e.phase).toBe('turnEnd');
    expect(e.phaseEndsAt).toBe(3000 + TURN_END_MS);
    expect(e.scores.A).toBeGreaterThan(0);
  });
  it('a guesser leaving after the others found ends the turn', () => {
    let room = mkRoom();
    const b = run(drawing(room), { type: 'guess', by: 'B', text: 'chat' }, mkCtx(room, 3000));
    expect(b.phase).toBe('drawing');
    room = disconnect(room, 'C');
    expect(run(b, { type: 'playerLeft', playerId: 'C' }, mkCtx(room, 4000)).phase).toBe('turnEnd');
  });
  it('drawer points stay within 100 when a finder disconnected before the turn ended', () => {
    let room = mkRoom();
    let s = run(drawing(room), { type: 'guess', by: 'B', text: 'chat' }, mkCtx(room, 3000));
    room = disconnect(room, 'B');
    s = run(s, { type: 'playerLeft', playerId: 'B' }, mkCtx(room, 3500));
    s = run(s, { type: 'guess', by: 'C', text: 'chat' }, mkCtx(room, 4000));
    expect(s.phase).toBe('turnEnd');
    expect(s.turnPoints.A).toBe(100);
  });
  it('drawer points count a disconnected finder as a guesser', () => {
    let room = { ...mkRoom(), players: ['A', 'B', 'C', 'D'].map((id, i) => ({ id, name: id, connected: true, joinedAt: i })) };
    let s = run(drawing(room), { type: 'guess', by: 'B', text: 'chat' }, mkCtx(room, 3000));
    room = disconnect(room, 'B');
    s = run(s, { type: 'playerLeft', playerId: 'B' }, mkCtx(room, 3500));
    s = run(s, { type: 'timeout' }, mkCtx(room, 2000 + 80000));
    // 1 finder out of {B (gone, found), C, D}
    expect(s.turnPoints.A).toBe(33);
  });
  it('chat keeps the last 100 entries', () => {
    const room = mkRoom();
    let s = drawing(room);
    for (let i = 0; i < 120; i++) s = run(s, { type: 'guess', by: 'B', text: `essai${i}` }, mkCtx(room, 3000));
    expect(s.chat).toHaveLength(100);
    expect(s.chat.at(-1)?.text).toBe('essai119');
  });
});

describe('hints', () => {
  const unlockAt = 2000 + 80000 * 0.67;
  it('A reveals only after unlock, up to maxHints, letters only', () => {
    const room = mkRoom();
    const s = drawing(room, 'arc-en-ciel');
    const early = reduce(s, { type: 'revealLetter', by: 'A', index: 0 }, mkCtx(room, unlockAt - 1));
    expect(early.state).toBe(s);
    expect(early.effects).toEqual([]);
    const ctx = mkCtx(room, unlockAt);
    expect(run(s, { type: 'revealLetter', by: 'A', index: 3 }, ctx)).toBe(s); // '-'
    const one = run(s, { type: 'revealLetter', by: 'A', index: 0 }, ctx);
    expect(one.revealed).toEqual([0]);
    expect(run(one, { type: 'revealLetter', by: 'A', index: 0 }, ctx)).toBe(one); // duplicate
    const two = run(one, { type: 'revealLetter', by: 'A', index: 1 }, ctx);
    expect(two.revealed).toEqual([0, 1]);
    expect(run(two, { type: 'revealLetter', by: 'A', index: 2 }, ctx)).toBe(two); // max
    expect(run(s, { type: 'revealLetter', by: 'A', index: 99 }, ctx)).toBe(s);
    expect(run(s, { type: 'revealLetter', by: 'A', index: 1.5 }, ctx)).toBe(s);
  });
});

describe('drawing ops', () => {
  const draw = (s: PictionaryState, by: string, op: DrawOp, room = mkRoom()) =>
    reduce(s, { type: 'draw', by, op }, mkCtx(room, 3000));

  it('non-drawer cannot draw or reveal', () => {
    const room = mkRoom();
    const s = drawing(room);
    expect(draw(s, 'B', { op: 'add', action: stroke() }).state).toBe(s);
    expect(draw(s, 'B', { op: 'undo' }).state).toBe(s);
    const r = reduce(s, { type: 'revealLetter', by: 'B', index: 0 }, mkCtx(room, 90000));
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);
  });
  it('add returns only a draw effect and stores a sanitized action', () => {
    const s = drawing();
    const dirty = { ...stroke(), evil: 'x' } as unknown as DrawAction;
    const r = draw(s, 'A', { op: 'add', action: dirty });
    expect(r.state.history.actions).toEqual([stroke('s1', [[1, 2]])]);
    expect(Object.keys(r.state.history.actions[0]!)).not.toContain('evil');
    expect(r.effects).toEqual([{ type: 'draw', op: { op: 'add', action: stroke('s1', [[1, 2]]) } }]);
  });
  it('add rejects invalid actions and draws outside drawing phase', () => {
    const s = drawing();
    const bad = { ...stroke(), color: 'red' };
    expect(draw(s, 'A', { op: 'add', action: bad }).effects).toEqual([]);
    const choosing = run(initialState(), { type: 'start', by: 'A' }, mkCtx(mkRoom()));
    expect(draw(choosing, 'A', { op: 'add', action: stroke() }).effects).toEqual([]);
  });
  it('append validates and bounds points', () => {
    let s = draw(drawing(), 'A', { op: 'add', action: stroke() }).state;
    const ok = draw(s, 'A', { op: 'append', id: 's1', points: [[3, 4], [5, 6]] });
    expect(ok.state.history.actions[0]).toMatchObject({ points: [[1, 2], [3, 4], [5, 6]] });
    expect(ok.effects).toEqual([{ type: 'draw', op: { op: 'append', id: 's1', points: [[3, 4], [5, 6]] } }]);
    const bad = (points: unknown, id = 's1') =>
      draw(s, 'A', { op: 'append', id, points: points as never });
    expect(bad([[1, 2]], 'other').effects).toEqual([]);
    expect(bad([]).effects).toEqual([]);
    expect(bad('x').effects).toEqual([]);
    expect(bad([[1, Infinity]]).effects).toEqual([]);
    expect(bad([[1]]).effects).toEqual([]);
    expect(bad(Array.from({ length: 201 }, () => [0, 0])).effects).toEqual([]);
    expect(bad(Array.from({ length: 200 }, () => [0, 0])).effects).toHaveLength(1);
    // total cap
    s = draw(drawing(), 'A', {
      op: 'add', action: stroke('s1', Array.from({ length: MAX_STROKE_POINTS - 1 }, () => [0, 0])),
    }).state;
    expect(draw(s, 'A', { op: 'append', id: 's1', points: [[1, 1]] }).state.history.actions[0]).toMatchObject({
      points: expect.arrayContaining([[1, 1]]),
    });
    expect(draw(s, 'A', { op: 'append', id: 's1', points: [[1, 1], [2, 2]] }).state).toBe(s);
  });
  it('append to a non-last or non-stroke action is ignored', () => {
    let s = draw(drawing(), 'A', { op: 'add', action: stroke('s1') }).state;
    s = draw(s, 'A', { op: 'add', action: { id: 'c1', kind: 'clear' } }).state;
    expect(draw(s, 'A', { op: 'append', id: 's1', points: [[1, 1]] }).state).toBe(s);
    expect(draw(s, 'A', { op: 'append', id: 'c1', points: [[1, 1]] }).state).toBe(s);
  });
  it('undo and redo relay; no-ops are ignored', () => {
    let s = draw(drawing(), 'A', { op: 'add', action: stroke() }).state;
    expect(draw(s, 'A', { op: 'redo' }).effects).toEqual([]);
    const u = draw(s, 'A', { op: 'undo' });
    expect(u.effects).toEqual([{ type: 'draw', op: { op: 'undo' } }]);
    expect(u.state.history.actions).toEqual([]);
    const r = draw(u.state, 'A', { op: 'redo' });
    expect(r.state.history.actions).toHaveLength(1);
    s = draw(drawing(), 'A', { op: 'undo' }).state;
    expect(draw(s, 'A', { op: 'undo' }).effects).toEqual([]);
  });
});

describe('endTurn and effects', () => {
  it('drawer leaving during choosing clears wordChoices', () => {
    let room = mkRoom();
    const s = run(initialState(), { type: 'start', by: 'A' }, mkCtx(room));
    expect(s.wordChoices).toHaveLength(3);
    room = disconnect(room, 'A');
    const e = run(s, { type: 'playerLeft', playerId: 'A' }, mkCtx(room, 2000));
    expect(e.phase).toBe('turnEnd');
    expect(e.wordChoices).toEqual([]);
    for (const id of ['A', 'B', 'C']) expect(viewFor(e, id, 2000, 'A').wordChoices).toBeNull();
  });
  it('changed() effects are fresh arrays', () => {
    const room = mkRoom();
    const a = reduce(initialState(), { type: 'playerJoined', playerId: 'Z' }, mkCtx(room));
    const b = reduce(initialState(), { type: 'playerJoined', playerId: 'Z' }, mkCtx(room));
    expect(a.effects).not.toBe(b.effects);
  });
});

describe('viewFor', () => {
  it('only the host sees customWords; everyone gets the count', () => {
    const s = drawing();
    const withWords = { ...s, settings: { ...s.settings, customWords: ['zorglub', 'plouf'] } };
    expect(viewFor(withWords, 'A', 0, 'A').settings.customWords).toEqual(['zorglub', 'plouf']);
    const b = viewFor(withWords, 'B', 0, 'A');
    expect(b.settings.customWords).toEqual([]);
    expect(JSON.stringify(b)).not.toContain('zorglub');
    expect(b.customWordsCount).toBe(2);
    expect(viewFor(withWords, 'A', 0, null).settings.customWords).toEqual([]);
  });
  it('guesser during drawing sees mask, no word, no choices', () => {
    const v = viewFor(drawing(), 'B', 5000, 'A');
    expect(v.word).toBeNull();
    expect(v.mask).toEqual(['_', '_', '_', '_']);
    expect(v.wordChoices).toBeNull();
    expect(v.isDrawer).toBe(false);
    expect(v.hasFound).toBe(false);
    expect(v.serverNow).toBe(5000);
    expect(v.hintsLeft).toBe(2);
    expect(v.turnOrder).toEqual(['A', 'B', 'C']);
  });
  it('drawer and finders see the word; others do not', () => {
    const room = mkRoom();
    const s = run(drawing(room, 'licorne'), { type: 'guess', by: 'B', text: 'licorne' }, mkCtx(room, 3000));
    expect(viewFor(s, 'A', 0, 'A').word).toBe('licorne');
    const b = viewFor(s, 'B', 0, 'A');
    expect(b.word).toBe('licorne');
    expect(b.hasFound).toBe(true);
    expect(b.found).toEqual(['B']);
    expect(viewFor(s, 'C', 0, 'A').word).toBeNull();
    expect(JSON.stringify(viewFor(s, 'C', 0, 'A'))).not.toContain('licorne');
  });
  it('choosing: only the drawer gets choices, nobody gets a word or mask', () => {
    const s = run(initialState(), { type: 'start', by: 'A' }, mkCtx(mkRoom()));
    expect(viewFor(s, 'A', 0, 'A').wordChoices).toHaveLength(3);
    expect(viewFor(s, 'B', 0, 'A').wordChoices).toBeNull();
    expect(viewFor(s, 'A', 0, 'A').word).toBeNull();
    expect(viewFor(s, 'A', 0, 'A').mask).toBeNull();
  });
  it('turnEnd and gameOver reveal the word to everyone', () => {
    const room = mkRoom();
    const e = run(drawing(room), { type: 'timeout' }, mkCtx(room, 2000 + 80000));
    const v = viewFor(e, 'C', 0, 'A');
    expect(v.word).toBe('chat');
    expect(v.mask).toEqual(['_', '_', '_', '_']);
    const over = run(e, { type: 'timeout' }, mkCtx(disconnect(disconnect(room, 'B'), 'C'), 2000 + 80000 + TURN_END_MS));
    expect(over.phase).toBe('gameOver');
    expect(viewFor(over, 'C', 0, 'A').word).toBeNull();
    expect(viewFor(over, 'C', 0, 'A').mask).toBeNull();
  });
  it('hintsLeft reflects revealed letters, floored at 0', () => {
    const s = { ...drawing(), revealed: [0, 1, 2] };
    expect(viewFor(s, 'B', 0, 'A').hintsLeft).toBe(0);
    expect(viewFor(s, 'B', 0, 'A').mask).toEqual(['c', 'h', 'a', '_']);
  });
});

