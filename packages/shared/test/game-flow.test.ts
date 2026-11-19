import { describe, it, expect } from 'vitest';
import {
  reduce, initialState, TURN_END_MS, type Ctx, type GameEvent, type PictionaryState,
} from '../src/pictionary/game';
import { DEFAULT_SETTINGS, clampSettings } from '../src/pictionary/settings';
import { disconnect, type Room } from '../src/room';
import words from '../src/pictionary/words-fr.json';

const mkRoom = (): Room => ({
  code: 'ABCDE', game: 'pictionary', hostId: 'A', tokens: {},
  players: ['A', 'B', 'C'].map((id, i) => ({ id, name: id, connected: true, joinedAt: i })),
});

function seeded(seed = 1) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

const mkCtx = (room: Room, now = 1000, rng = seeded()): Ctx => ({ now, rng, room, words });

function run(state: PictionaryState, ev: GameEvent, ctx: Ctx) {
  return reduce(state, ev, ctx).state;
}

function started(room = mkRoom(), settings = DEFAULT_SETTINGS, now = 1000) {
  const ctx = mkCtx(room, now);
  return run(initialState(settings), { type: 'start', by: 'A' }, ctx);
}

describe('start', () => {
  it('ignores non-host', () => {
    const r = reduce(initialState(), { type: 'start', by: 'B' }, mkCtx(mkRoom()));
    expect(r.state.phase).toBe('lobby');
    expect(r.effects).toEqual([]);
  });
  it('ignores with fewer than 2 connected players', () => {
    const room = { ...mkRoom(), players: mkRoom().players.slice(0, 1) };
    expect(run(initialState(), { type: 'start', by: 'A' }, mkCtx(room)).phase).toBe('lobby');
  });
  it('starts: choosing, drawer A, 3 distinct choices', () => {
    const r = reduce(initialState(), { type: 'start', by: 'A' }, mkCtx(mkRoom()));
    expect(r.effects).toEqual([{ type: 'state' }]);
    expect(r.state.phase).toBe('choosing');
    expect(r.state.drawerId).toBe('A');
    expect(r.state.round).toBe(1);
    expect(r.state.turnOrder).toEqual(['A', 'B', 'C']);
    expect(r.state.scores).toEqual({ A: 0, B: 0, C: 0 });
    expect(r.state.wordChoices).toHaveLength(3);
    expect(new Set(r.state.wordChoices).size).toBe(3);
    expect(r.state.phaseEndsAt).toBe(1000 + 15000);
  });
  it('cannot start twice', () => {
    const s = started();
    expect(reduce(s, { type: 'start', by: 'A' }, mkCtx(mkRoom())).effects).toEqual([]);
  });
});

describe('choosing and drawing', () => {
  it('ignores chooseWord by non-drawer or bad index', () => {
    const s = started();
    const ctx = mkCtx(mkRoom());
    expect(run(s, { type: 'chooseWord', by: 'B', index: 0 }, ctx).phase).toBe('choosing');
    expect(run(s, { type: 'chooseWord', by: 'A', index: 3 }, ctx).phase).toBe('choosing');
  });
  it('drawer choosing moves to drawing', () => {
    const s = started();
    const d = run(s, { type: 'chooseWord', by: 'A', index: 1 }, mkCtx(mkRoom(), 5000));
    expect(d.phase).toBe('drawing');
    expect(d.word).toBe(s.wordChoices[1]);
    expect(d.drawStartedAt).toBe(5000);
    expect(d.phaseEndsAt).toBe(5000 + 80000);
    expect(d.usedWords).toEqual([s.wordChoices[1]]);
  });
  it('choosing timeout picks a word', () => {
    const s = started();
    const d = run(s, { type: 'timeout' }, mkCtx(mkRoom(), 1000 + 15000));
    expect(d.phase).toBe('drawing');
    expect(s.wordChoices).toContain(d.word);
  });
  it('ignores stale timeout', () => {
    const s = started();
    const r = reduce(s, { type: 'timeout' }, mkCtx(mkRoom(), 1000 + 14999));
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);
  });
  it('drawing timeout ends the turn with the word in chat', () => {
    const room = mkRoom();
    const d = run(started(), { type: 'chooseWord', by: 'A', index: 0 }, mkCtx(room, 2000));
    const e = run(d, { type: 'timeout' }, mkCtx(room, 2000 + 80000));
    expect(e.phase).toBe('turnEnd');
    expect(e.phaseEndsAt).toBe(2000 + 80000 + TURN_END_MS);
    expect(e.chat.at(-1)).toMatchObject({ kind: 'system', text: `« Le mot était : ${d.word} »` });
  });
});

describe('turn loop', () => {
  it('rounds: 1 with 3 players ends after 3 turns', () => {
    const room = mkRoom();
    let s = started(room, { ...DEFAULT_SETTINGS, rounds: 1 });
    let now = 1000;
    const drawers: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      drawers.push(s.drawerId);
      now += 15000; s = run(s, { type: 'timeout' }, mkCtx(room, now));
      now += 80000; s = run(s, { type: 'timeout' }, mkCtx(room, now));
      expect(s.phase).toBe('turnEnd');
      now += TURN_END_MS; s = run(s, { type: 'timeout' }, mkCtx(room, now));
    }
    expect(drawers).toEqual(['A', 'B', 'C']);
    expect(s.phase).toBe('gameOver');
    expect(s.phaseEndsAt).toBeNull();
  });
  it('wraps to round 2', () => {
    const room = mkRoom();
    let s = started(room, { ...DEFAULT_SETTINGS, rounds: 2 });
    let now = 1000;
    for (let i = 0; i < 3; i++) {
      now += 15000; s = run(s, { type: 'timeout' }, mkCtx(room, now));
      now += 80000; s = run(s, { type: 'timeout' }, mkCtx(room, now));
      now += TURN_END_MS; s = run(s, { type: 'timeout' }, mkCtx(room, now));
    }
    expect(s.phase).toBe('choosing');
    expect(s.round).toBe(2);
    expect(s.drawerId).toBe('A');
  });
  it('drawer leaving ends the turn, then B draws', () => {
    let room = mkRoom();
    const d = run(started(room), { type: 'chooseWord', by: 'A', index: 0 }, mkCtx(room, 2000));
    room = disconnect(room, 'A');
    const e = run(d, { type: 'playerLeft', playerId: 'A' }, mkCtx(room, 3000));
    expect(e.phase).toBe('turnEnd');
    expect(e.phaseEndsAt).toBe(3000 + TURN_END_MS);
    const n = run(e, { type: 'timeout' }, mkCtx(room, 3000 + TURN_END_MS));
    expect(n.phase).toBe('choosing');
    expect(n.drawerId).toBe('B');
  });
  it('skips disconnected drawers', () => {
    let room = mkRoom();
    const d = run(started(room), { type: 'chooseWord', by: 'A', index: 0 }, mkCtx(room, 2000));
    const e = run(d, { type: 'timeout' }, mkCtx(room, 82000));
    room = disconnect(room, 'B');
    const n = run(e, { type: 'timeout' }, mkCtx(room, 87000));
    expect(n.drawerId).toBe('C');
  });
  it('fewer than 2 connected players ends the game at the next turn', () => {
    let room = mkRoom();
    const s = started(room);
    room = disconnect(disconnect(room, 'B'), 'C');
    const left = run(s, { type: 'playerLeft', playerId: 'C' }, mkCtx(room));
    expect(left.phase).toBe('choosing');
    const d = run(left, { type: 'timeout' }, mkCtx(room, 16000));
    const e = run(d, { type: 'timeout' }, mkCtx(room, 96000));
    expect(e.phase).toBe('turnEnd');
    expect(run(e, { type: 'timeout' }, mkCtx(room, 96000 + TURN_END_MS)).phase).toBe('gameOver');
  });
  describe('2 players, guesser refreshes', () => {
    const two = (): Room => ({ ...mkRoom(), players: mkRoom().players.slice(0, 2) });
    const drawingTwo = () => {
      const room = two();
      return run(started(room), { type: 'chooseWord', by: 'A', index: 0 }, mkCtx(room, 2000));
    };
    it('guesser disconnecting during drawing keeps the turn going', () => {
      const room = disconnect(two(), 'B');
      expect(run(drawingTwo(), { type: 'playerLeft', playerId: 'B' }, mkCtx(room, 3000)).phase).toBe('drawing');
    });
    it('guesser reconnecting continues the game', () => {
      const gone = disconnect(two(), 'B');
      let s = run(drawingTwo(), { type: 'playerLeft', playerId: 'B' }, mkCtx(gone, 3000));
      const back = two();
      s = run(s, { type: 'playerJoined', playerId: 'B' }, mkCtx(back, 4000));
      expect(s.phase).toBe('drawing');
      s = run(s, { type: 'timeout' }, mkCtx(back, 2000 + 80000));
      s = run(s, { type: 'timeout' }, mkCtx(back, 2000 + 80000 + TURN_END_MS));
      expect(s.phase).toBe('choosing');
      expect(s.drawerId).toBe('B');
    });
    it('guesser still gone when the next turn begins → gameOver', () => {
      const gone = disconnect(two(), 'B');
      let s = run(drawingTwo(), { type: 'playerLeft', playerId: 'B' }, mkCtx(gone, 3000));
      s = run(s, { type: 'timeout' }, mkCtx(gone, 2000 + 80000));
      expect(s.phase).toBe('turnEnd');
      s = run(s, { type: 'timeout' }, mkCtx(gone, 2000 + 80000 + TURN_END_MS));
      expect(s.phase).toBe('gameOver');
    });
  });
  it('a non-drawer leaving does not end the turn', () => {
    let room = mkRoom();
    const s = started(room);
    room = disconnect(room, 'C');
    expect(run(s, { type: 'playerLeft', playerId: 'C' }, mkCtx(room)).phase).toBe('choosing');
  });
  it('late joiner is appended to the turn order', () => {
    const s = started();
    const n = run(s, { type: 'playerJoined', playerId: 'D' }, mkCtx(mkRoom()));
    expect(n.turnOrder).toEqual(['A', 'B', 'C', 'D']);
    expect(n.scores.D).toBe(0);
  });
});

describe('words', () => {
  it('only mode with too few custom words falls back to the default list', () => {
    const settings = clampSettings({ customWords: ['zorglub'], customWordsMode: 'only', wordChoices: 3 });
    const s = started(mkRoom(), settings);
    expect(s.wordChoices).toHaveLength(3);
    for (const w of s.wordChoices) expect(words).toContain(w);
  });
  it('only mode with enough custom words uses them', () => {
    const settings = clampSettings({ customWords: ['a1', 'b2', 'c3', 'd4'], customWordsMode: 'only' });
    const s = started(mkRoom(), settings);
    for (const w of s.wordChoices) expect(['a1', 'b2', 'c3', 'd4']).toContain(w);
  });
  it('reuses words instead of failing when the pool is exhausted', () => {
    const room = mkRoom();
    const ctx = { ...mkCtx(room), words: ['x', 'y', 'z'] };
    let s = run(initialState(), { type: 'start', by: 'A' }, ctx);
    s = run(s, { type: 'chooseWord', by: 'A', index: 0 }, ctx);
    s = run(s, { type: 'timeout' }, { ...ctx, now: ctx.now + 80000 });
    s = run(s, { type: 'timeout' }, { ...ctx, now: ctx.now + 80000 + TURN_END_MS });
    expect(s.phase).toBe('choosing');
    expect(s.wordChoices).toHaveLength(3);
  });
  it('bundled list has at least 300 unique non-empty entries', () => {
    expect(words.every((w) => typeof w === 'string' && w.trim() !== '' && w === w.toLowerCase())).toBe(true);
    expect(new Set(words).size).toBe(words.length);
    expect(words.length).toBeGreaterThanOrEqual(300);
  });
});

describe('settings and restart', () => {
  it('only host may change settings, only in lobby', () => {
    const ctx = mkCtx(mkRoom());
    const l = initialState();
    expect(run(l, { type: 'setSettings', by: 'B', settings: { rounds: 5 } }, ctx).settings.rounds).toBe(3);
    const l2 = run(l, { type: 'setSettings', by: 'A', settings: { rounds: 5 } }, ctx);
    expect(l2.settings.rounds).toBe(5);
    const s = run(l2, { type: 'start', by: 'A' }, ctx);
    expect(run(s, { type: 'setSettings', by: 'A', settings: { rounds: 7 } }, ctx).settings.rounds).toBe(5);
  });
  it('settings persist into restart; restart only from gameOver by host', () => {
    const room = mkRoom();
    const ctx = mkCtx(room);
    let s = run(initialState(), { type: 'setSettings', by: 'A', settings: { rounds: 1 } }, ctx);
    s = run(s, { type: 'start', by: 'A' }, ctx);
    expect(run(s, { type: 'restart', by: 'A' }, ctx).phase).toBe('choosing');
    const alone = mkCtx(disconnect(disconnect(room, 'B'), 'C'));
    let over = run(s, { type: 'playerLeft', playerId: 'B' }, alone);
    for (const now of [16000, 96000, 96000 + TURN_END_MS]) over = run(over, { type: 'timeout' }, { ...alone, now });
    expect(over.phase).toBe('gameOver');
    expect(run(over, { type: 'restart', by: 'B' }, ctx).phase).toBe('gameOver');
    const r = run(over, { type: 'restart', by: 'A' }, ctx);
    expect(r.phase).toBe('lobby');
    expect(r.settings.rounds).toBe(1);
    expect(r.scores).toEqual({});
    expect(r.turnOrder).toEqual([]);
    expect(r.usedWords).toEqual([]);
  });
});
