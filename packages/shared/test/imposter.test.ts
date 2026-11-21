import { describe, it, expect } from 'vitest';
import { reduce, initialState, type Ctx, type GameEvent, type PictionaryState } from '../src/pictionary/game';
import { DEFAULT_SETTINGS, clampSettings, type PictionarySettings } from '../src/pictionary/settings';
import { viewFor } from '../src/pictionary/view';
import { isValidAction, type DrawAction } from '../src/pictionary/drawing';
import {
  IMP_PALETTE, IMP_RESULT_MS, IMP_REVEAL_MS, IMP_GUESS_MS, IMP_VOTE_MS, IMPOSTER_WORDS,
  makeScribble, pickImposterWord,
} from '../src/pictionary/imposter';
import { parseClientMsg } from '../src/protocol';
import { disconnect, type Room } from '../src/room';
import words from '../src/pictionary/words-fr.json';

const mkRoom = (ids = ['A', 'B', 'C']): Room => ({
  code: 'ABCDE', game: 'pictionary', hostId: 'A', ownerId: 'A', tokens: {},
  players: ids.map((id, i) => ({ id, name: id, connected: true, joinedAt: i })),
});

function seeded(seed = 1) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

const IMP: PictionarySettings = { ...DEFAULT_SETTINGS, mode: 'imposteur' };

type T = { s: PictionaryState; room: Room; now: number; rng: () => number };
const ctxOf = (t: T): Ctx => ({ now: t.now, rng: t.rng, room: t.room, words });
const send = (t: T, ev: GameEvent) => {
  const r = reduce(t.s, ev, ctxOf(t));
  t.s = r.state;
  return r;
};
/** Jumps to the end of the current phase and fires the timeout. */
const expire = (t: T) => {
  t.now = t.s.phaseEndsAt!;
  return send(t, { type: 'timeout' });
};

function begin(settings: Partial<PictionarySettings> = {}, ids = ['A', 'B', 'C'], seed = 1): T {
  const t: T = { s: initialState({ ...IMP, ...settings }), room: mkRoom(ids), now: 1000, rng: seeded(seed) };
  send(t, { type: 'start', by: 'A' });
  return t;
}
const imp = (t: T) => t.s.imp!;
const drawerOf = (t: T) => t.s.drawerId!;
const nonImposters = (t: T) => imp(t).order.filter((id) => id !== imp(t).imposterId);

let strokeN = 0;
const stroke = (color: string, extra: Partial<Extract<DrawAction, { kind: 'stroke' }>> = {}): DrawAction => ({
  id: `st${++strokeN}`, kind: 'stroke', tool: 'pen', color, size: 6, opacity: 1, points: [[10, 10], [20, 20]], ...extra,
});

/** The current drawer draws one stroke and ends their turn. */
function drawTurn(t: T) {
  const by = drawerOf(t);
  const action = stroke(imp(t).colors[by]!);
  expect(send(t, { type: 'draw', by, op: { op: 'add', action } }).effects).toEqual([{ type: 'draw', op: { op: 'add', action } }]);
  expect(send(t, { type: 'draw', by, op: { op: 'append', id: action.id, points: [[30, 30]] } }).effects).toHaveLength(1);
  send(t, { type: 'impStrokeDone', by });
}

/** Reveal → all turns → discussion skipped → vote phase. */
function toVote(t: T) {
  expire(t);
  expect(t.s.phase).toBe('impDrawing');
  while (t.s.phase === 'impDrawing') drawTurn(t);
  expect(t.s.phase).toBe('impDiscuss');
  send(t, { type: 'impSkip', by: 'A' });
  expect(t.s.phase).toBe('impVote');
}

describe('settings', () => {
  it('has the imposter defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      mode: 'classique', impRounds: 3, impTableRounds: 2, impStrokeSeconds: 20, impDiscussSeconds: 60, impScribble: true,
    });
    expect(clampSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps the imposter settings', () => {
    expect(clampSettings({ impRounds: 0, impTableRounds: 9, impStrokeSeconds: 5, impDiscussSeconds: 500 })).toMatchObject({
      impRounds: 1, impTableRounds: 4, impStrokeSeconds: 10, impDiscussSeconds: 180,
    });
    expect(clampSettings({ impRounds: 11, impTableRounds: 0, impStrokeSeconds: 99, impDiscussSeconds: -1 })).toMatchObject({
      impRounds: 10, impTableRounds: 1, impStrokeSeconds: 60, impDiscussSeconds: 0,
    });
    expect(clampSettings({ mode: 'imposteur', impScribble: false })).toMatchObject({ mode: 'imposteur', impScribble: false });
    expect(clampSettings({ mode: 'chess', impScribble: 'no' })).toMatchObject({ mode: 'classique', impScribble: true });
  });
});

describe('word bank', () => {
  it('has ≥12 categories × ≥25 lowercase words, unique across categories', () => {
    const cats = Object.keys(IMPOSTER_WORDS);
    expect(cats.length).toBeGreaterThanOrEqual(12);
    for (const c of [
      'Animaux', 'Nourriture', 'Objets de la maison', 'Métiers', 'Sports', 'Lieux', 'Moyens de transport',
      'Vêtements & accessoires', 'Instruments de musique', 'Personnages de fiction', 'Nature & météo', 'Fête & loisirs',
    ]) expect(cats).toContain(c);
    const all = Object.values(IMPOSTER_WORDS).flat();
    for (const c of cats) expect(IMPOSTER_WORDS[c]!.length, c).toBeGreaterThanOrEqual(25);
    for (const w of all) {
      expect(w, w).toBe(w.toLowerCase());
      expect(w, w).toBe(w.trim());
      expect(w.length, w).toBeGreaterThan(0);
    }
    expect(new Set(all).size).toBe(all.length);
  });
  it('picks a word of its category, skipping used ones', () => {
    const rng = seeded(3);
    const p = pickImposterWord(rng, []);
    expect(IMPOSTER_WORDS[p.category]).toContain(p.word);
    const all = Object.values(IMPOSTER_WORDS).flat();
    const used = all.filter((w) => w !== 'girafe');
    expect(pickImposterWord(rng, used)).toEqual({ category: 'Animaux', word: 'girafe' });
    // Everything used: starts over rather than failing.
    expect(all).toContain(pickImposterWord(rng, all).word);
  });
});

describe('scribble', () => {
  it('is one grey smooth stroke inside the canvas', () => {
    for (let seed = 1; seed < 20; seed++) {
      const a = makeScribble(seeded(seed), 'scr');
      expect(isValidAction(a)).toBe(true);
      expect(a).toMatchObject({ id: 'scr', kind: 'stroke', tool: 'pen', color: '#9ca3af', size: 6, opacity: 1 });
      const pts = (a as Extract<DrawAction, { kind: 'stroke' }>).points;
      expect(pts.length).toBeGreaterThanOrEqual(10);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(800);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(600);
      }
    }
  });
});

describe('palette', () => {
  it('has 12 distinct colours, none of them the scribble grey', () => {
    expect(IMP_PALETTE).toHaveLength(12);
    expect(new Set(IMP_PALETTE.map((c) => c.toLowerCase())).size).toBe(12);
    expect(IMP_PALETTE).not.toContain('#9ca3af');
    for (const c of IMP_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('protocol', () => {
  it('parses the imposter messages', () => {
    expect(parseClientMsg('{"t":"impDone"}')).toEqual({ t: 'impDone' });
    expect(parseClientMsg('{"t":"impSkip"}')).toEqual({ t: 'impSkip' });
    expect(parseClientMsg('{"t":"impVote","target":"B"}')).toEqual({ t: 'impVote', target: 'B' });
    expect(parseClientMsg('{"t":"impGuess","text":"chat"}')).toEqual({ t: 'impGuess', text: 'chat' });
    expect(parseClientMsg('{"t":"impVote"}')).toBeNull();
    expect(parseClientMsg('{"t":"impGuess","text":3}')).toBeNull();
  });
});

describe('imposter start', () => {
  it('needs 3 connected players', () => {
    const t = begin({}, ['A', 'B']);
    expect(t.s.phase).toBe('lobby');
  });
  it('starts manche 1 with a reveal, a random order, colours and the scribble', () => {
    const t = begin();
    expect(t.s.phase).toBe('impReveal');
    expect(t.s.phaseEndsAt).toBe(1000 + IMP_REVEAL_MS);
    expect(t.s.scores).toEqual({ A: 0, B: 0, C: 0 });
    const i = imp(t);
    expect(i.manche).toBe(1);
    expect([...i.order].sort()).toEqual(['A', 'B', 'C']);
    expect(i.order).toContain(i.imposterId);
    expect(IMPOSTER_WORDS[i.category]).toContain(i.word);
    expect(i.order.map((id) => i.colors[id])).toEqual(IMP_PALETTE.slice(0, 3));
    expect(i.turn).toBe(0);
    expect(i.votes).toEqual({});
    expect(t.s.history.actions).toHaveLength(1);
    expect(t.s.history.actions[0]).toEqual(i.scribble);
    expect(t.s.drawerId).toBeNull();
    expect(t.s.word).toBeNull();
  });
  it('no scribble when disabled', () => {
    const t = begin({ impScribble: false });
    expect(t.s.history.actions).toEqual([]);
    expect(imp(t).scribble).toBeNull();
  });
  it('varies the imposter and order with the rng', () => {
    const imposters = new Set<string>();
    const orders = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const t = begin({}, ['A', 'B', 'C'], seed);
      imposters.add(imp(t).imposterId);
      orders.add(imp(t).order.join());
    }
    expect(imposters.size).toBe(3);
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('imposter drawing turns', () => {
  it('goes through order × tableRounds turns then discussion', () => {
    const t = begin();
    expire(t);
    const order = imp(t).order;
    const seen: string[] = [];
    while (t.s.phase === 'impDrawing') {
      expect(t.s.phaseEndsAt).toBe(t.now + 20000);
      seen.push(drawerOf(t));
      drawTurn(t);
    }
    expect(seen).toEqual([...order, ...order]);
    expect(t.s.phase).toBe('impDiscuss');
    expect(t.s.phaseEndsAt).toBe(t.now + 60000);
    expect(t.s.drawerId).toBeNull();
    // 1 scribble + 6 strokes
    expect(t.s.history.actions).toHaveLength(7);
  });

  it('a turn timeout passes the turn, with or without a stroke', () => {
    const t = begin({ impTableRounds: 1 });
    expire(t);
    const order = imp(t).order;
    expect(drawerOf(t)).toBe(order[0]);
    expire(t);
    expect(drawerOf(t)).toBe(order[1]);
    expect(imp(t).turn).toBe(1);
    send(t, { type: 'draw', by: order[1]!, op: { op: 'add', action: stroke(imp(t).colors[order[1]!]!) } });
    expire(t);
    expect(drawerOf(t)).toBe(order[2]);
    expect(imp(t).strokeId).toBeNull();
    expire(t);
    expect(t.s.phase).toBe('impDiscuss');
  });

  it('impStrokeDone needs the current drawer and a started stroke', () => {
    const t = begin();
    expire(t);
    const [d, other] = [drawerOf(t), imp(t).order[1]!];
    expect(send(t, { type: 'impStrokeDone', by: d }).effects).toEqual([]);
    send(t, { type: 'draw', by: d, op: { op: 'add', action: stroke(imp(t).colors[d]!) } });
    expect(send(t, { type: 'impStrokeDone', by: other }).effects).toEqual([]);
    expect(drawerOf(t)).toBe(d);
    send(t, { type: 'impStrokeDone', by: d });
    expect(drawerOf(t)).toBe(other);
  });

  it('rejects bad strokes', () => {
    const t = begin();
    expire(t);
    const d = drawerOf(t);
    const other = imp(t).order.find((id) => id !== d)!;
    const mine = imp(t).colors[d]!;
    const before = t.s;
    const rejected: DrawAction[] = [
      stroke(imp(t).colors[other]!), // wrong colour
      stroke('#000000'),
      stroke(mine, { size: 4 }),
      stroke(mine, { tool: 'eraser' }),
      { id: 'c1', kind: 'clear' },
      { id: 'f1', kind: 'fill', color: mine, opacity: 1, at: [1, 1] },
      { id: 'l1', kind: 'line', color: mine, size: 6, opacity: 1, filled: false, from: [1, 1], to: [5, 5] },
      stroke(mine, { id: imp(t).scribble!.id }), // id already in history
    ];
    for (const action of rejected) {
      const r = send(t, { type: 'draw', by: d, op: { op: 'add', action } });
      expect(r.effects, JSON.stringify(action)).toEqual([]);
    }
    // Not the current drawer, even with their own colour.
    expect(send(t, { type: 'draw', by: other, op: { op: 'add', action: stroke(imp(t).colors[other]!) } }).effects).toEqual([]);
    expect(send(t, { type: 'draw', by: d, op: { op: 'undo' } }).effects).toEqual([]);
    expect(send(t, { type: 'draw', by: d, op: { op: 'redo' } }).effects).toEqual([]);
    expect(t.s).toBe(before);

    // A good stroke, then a second one in the same turn is refused; append only to the turn's stroke.
    const good = stroke(mine, { opacity: 0.2 });
    const r = send(t, { type: 'draw', by: d, op: { op: 'add', action: good } });
    expect(r.effects).toEqual([{ type: 'draw', op: { op: 'add', action: { ...good, opacity: 1 } } }]);
    expect(imp(t).strokeId).toBe(good.id);
    expect(send(t, { type: 'draw', by: d, op: { op: 'add', action: stroke(mine) } }).effects).toEqual([]);
    expect(send(t, { type: 'draw', by: d, op: { op: 'append', id: 'nope', points: [[1, 1]] } }).effects).toEqual([]);
    expect(send(t, { type: 'draw', by: other, op: { op: 'append', id: good.id, points: [[1, 1]] } }).effects).toEqual([]);
    expect(send(t, { type: 'draw', by: d, op: { op: 'undo' } }).effects).toEqual([]);
    expect(send(t, { type: 'draw', by: d, op: { op: 'append', id: good.id, points: [[1, 1]] } }).effects).toHaveLength(1);

    // After the turn: the old drawer can no longer append.
    send(t, { type: 'impStrokeDone', by: d });
    expect(send(t, { type: 'draw', by: d, op: { op: 'append', id: good.id, points: [[2, 2]] } }).effects).toEqual([]);
  });

  it('rejects strokes outside the drawing phase', () => {
    const t = begin();
    const d = imp(t).order[0]!;
    expect(send(t, { type: 'draw', by: d, op: { op: 'add', action: stroke(imp(t).colors[d]!) } }).effects).toEqual([]);
  });

  it('a drawer who disconnects passes the turn at once and is skipped afterwards', () => {
    const t = begin({}, ['A', 'B', 'C', 'D']);
    expire(t);
    const order = imp(t).order;
    drawTurn(t);
    expect(drawerOf(t)).toBe(order[1]);
    const gone = order[1]!;
    t.room = disconnect(t.room, gone);
    send(t, { type: 'playerLeft', playerId: gone });
    expect(drawerOf(t)).toBe(order[2]);
    expect(imp(t).turn).toBe(2);
    drawTurn(t);
    drawTurn(t);
    expect(drawerOf(t)).toBe(order[0]);
    drawTurn(t);
    expect(drawerOf(t)).toBe(order[2]);
    // A non-drawer leaving changes nothing.
    t.room = disconnect(t.room, order[3]!);
    send(t, { type: 'playerLeft', playerId: order[3]! });
    expect(drawerOf(t)).toBe(order[2]);
  });

  it('chat guesses are ignored', () => {
    const t = begin();
    expire(t);
    const other = imp(t).order[1]!;
    expect(send(t, { type: 'guess', by: other, text: imp(t).word }).effects).toEqual([]);
    expect(send(t, { type: 'guess', by: other, text: 'bonjour' }).effects).toEqual([]);
    expect(t.s.chat).toEqual([]);
  });

  it('discussion of 0 s goes straight to the vote', () => {
    const t = begin({ impDiscussSeconds: 0, impTableRounds: 1 });
    expire(t);
    while (t.s.phase === 'impDrawing') drawTurn(t);
    expect(t.s.phase).toBe('impVote');
    expect(t.s.phaseEndsAt).toBe(t.now + IMP_VOTE_MS);
  });

  it('only the host can skip the discussion; the timer also ends it', () => {
    const t = begin({ impTableRounds: 1 });
    expire(t);
    while (t.s.phase === 'impDrawing') drawTurn(t);
    expect(send(t, { type: 'impSkip', by: 'B' }).effects).toEqual([]);
    expire(t);
    expect(t.s.phase).toBe('impVote');
  });
});

describe('imposter vote and guess', () => {
  it('full manche: imposter caught, right guess → imposter +2, then manche 2', () => {
    const t = begin();
    toVote(t);
    const { imposterId, word } = imp(t);
    const [x, y] = nonImposters(t) as [string, string];
    expect(t.s.phaseEndsAt).toBe(t.now + IMP_VOTE_MS);
    send(t, { type: 'impVote', by: x, target: imposterId });
    send(t, { type: 'impVote', by: imposterId, target: x });
    expect(t.s.phase).toBe('impVote');
    send(t, { type: 'impVote', by: y, target: imposterId });
    expect(t.s.phase).toBe('impGuess');
    expect(t.s.phaseEndsAt).toBe(t.now + IMP_GUESS_MS);
    expect(imp(t).accused).toBe(imposterId);
    // Only the imposter may guess.
    expect(send(t, { type: 'impGuess', by: x, text: word }).effects).toEqual([]);
    send(t, { type: 'impGuess', by: imposterId, text: ` ${word.toUpperCase()} ` });
    expect(t.s.phase).toBe('impResult');
    expect(t.s.phaseEndsAt).toBe(t.now + IMP_RESULT_MS);
    expect(imp(t).imposterWon).toBe(true);
    expect(t.s.scores).toEqual({ [imposterId]: 2, [x]: 0, [y]: 0 });
    expect(send(t, { type: 'impGuess', by: imposterId, text: word }).effects).toEqual([]);

    expire(t);
    expect(t.s.phase).toBe('impReveal');
    expect(imp(t).manche).toBe(2);
    expect(imp(t).votes).toEqual({});
    expect(imp(t).word).not.toBe(word);
    expect(t.s.usedWords).toContain(word);
    expect(t.s.scores[imposterId]).toBe(2);
  });

  it('caught and wrong guess → every drawer +1', () => {
    const t = begin();
    toVote(t);
    const { imposterId, word } = imp(t);
    const [x, y] = nonImposters(t) as [string, string];
    send(t, { type: 'impVote', by: x, target: imposterId });
    send(t, { type: 'impVote', by: y, target: imposterId });
    send(t, { type: 'impVote', by: imposterId, target: y });
    expect(t.s.phase).toBe('impGuess');
    send(t, { type: 'impGuess', by: imposterId, text: `${word}zz` });
    expect(t.s.phase).toBe('impResult');
    expect(imp(t).imposterWon).toBe(false);
    expect(imp(t).guess).toBe(`${word}zz`);
    expect(t.s.scores).toEqual({ [imposterId]: 0, [x]: 1, [y]: 1 });
  });

  it('drawers +1 even if they left; guess timeout counts as wrong', () => {
    const t = begin();
    toVote(t);
    const { imposterId } = imp(t);
    const [x, y] = nonImposters(t) as [string, string];
    send(t, { type: 'impVote', by: x, target: imposterId });
    send(t, { type: 'impVote', by: y, target: imposterId });
    t.room = disconnect(t.room, x);
    send(t, { type: 'playerLeft', playerId: x });
    // The imposter has not voted yet: still waiting.
    expect(t.s.phase).toBe('impVote');
    send(t, { type: 'impVote', by: imposterId, target: y });
    expect(t.s.phase).toBe('impGuess');
    expire(t);
    expect(t.s.phase).toBe('impResult');
    expect(imp(t).guess).toBeNull();
    expect(imp(t).imposterWon).toBe(false);
    expect(t.s.scores).toEqual({ [imposterId]: 0, [x]: 1, [y]: 1 });
  });

  it('tie → imposter escapes without a guess phase', () => {
    const t = begin();
    toVote(t);
    const { imposterId } = imp(t);
    const [x, y] = nonImposters(t) as [string, string];
    send(t, { type: 'impVote', by: x, target: imposterId });
    send(t, { type: 'impVote', by: y, target: x });
    send(t, { type: 'impVote', by: imposterId, target: y });
    expect(t.s.phase).toBe('impResult');
    expect(imp(t).accused).toBeNull();
    expect(imp(t).imposterWon).toBe(true);
    expect(t.s.scores).toEqual({ [imposterId]: 2, [x]: 0, [y]: 0 });
  });

  it('nobody votes → imposter escapes at the timeout', () => {
    const t = begin();
    toVote(t);
    expire(t);
    expect(t.s.phase).toBe('impResult');
    expect(imp(t).accused).toBeNull();
    expect(imp(t).imposterWon).toBe(true);
  });

  it('wrong player accused → imposter +2', () => {
    const t = begin();
    toVote(t);
    const { imposterId } = imp(t);
    const [x, y] = nonImposters(t) as [string, string];
    send(t, { type: 'impVote', by: x, target: y });
    send(t, { type: 'impVote', by: imposterId, target: y });
    send(t, { type: 'impVote', by: y, target: x });
    expect(t.s.phase).toBe('impResult');
    expect(imp(t).accused).toBe(y);
    expect(imp(t).imposterWon).toBe(true);
    expect(t.s.scores).toEqual({ [imposterId]: 2, [x]: 0, [y]: 0 });
  });

  it('rejects self-votes and unknown targets; a vote can change', () => {
    const t = begin();
    toVote(t);
    const { imposterId } = imp(t);
    const [x, y] = nonImposters(t) as [string, string];
    expect(send(t, { type: 'impVote', by: x, target: x }).effects).toEqual([]);
    expect(send(t, { type: 'impVote', by: x, target: 'Z' }).effects).toEqual([]);
    send(t, { type: 'impVote', by: x, target: y });
    send(t, { type: 'impVote', by: x, target: imposterId });
    expect(imp(t).votes).toEqual({ [x]: imposterId });
  });

  it('votes are only taken during the vote phase', () => {
    const t = begin();
    expire(t);
    const [a, b] = imp(t).order as [string, string];
    expect(send(t, { type: 'impVote', by: a, target: b }).effects).toEqual([]);
  });

  it('fewer than 3 connected at a manche start → gameOver', () => {
    const t = begin();
    toVote(t);
    expire(t); // nobody votes → result
    t.room = disconnect(t.room, 'C');
    send(t, { type: 'playerLeft', playerId: 'C' });
    expire(t);
    expect(t.s.phase).toBe('gameOver');
    expect(t.s.phaseEndsAt).toBeNull();
  });

  it('ends after impRounds manches; restart goes back to the lobby', () => {
    const t = begin({ impRounds: 1 });
    toVote(t);
    expire(t);
    expire(t);
    expect(t.s.phase).toBe('gameOver');
    send(t, { type: 'restart', by: 'A' });
    expect(t.s.phase).toBe('lobby');
    expect(t.s.imp).toBeNull();
  });
});

describe('imposter views', () => {
  const v = (t: T, id: string) => viewFor(t.s, id, t.now, 'A');

  it('the imposter never sees the word before the result; votes stay hidden', () => {
    const t = begin();
    const SECRET = 'zorglubium';
    t.s = { ...t.s, imp: { ...imp(t), word: SECRET } };
    const { imposterId } = imp(t);
    const [x, y] = nonImposters(t) as [string, string];
    const check = () => {
      const iv = v(t, imposterId);
      expect(JSON.stringify(iv)).not.toContain(SECRET);
      expect(iv.imp!.isImposter).toBe(true);
      expect(iv.imp!.word).toBeNull();
      expect(iv.imp!.category).toBe(imp(t).category);
      const xv = v(t, x);
      expect(xv.imp!.isImposter).toBe(false);
      expect(xv.imp!.word).toBe(SECRET);
      // Nobody learns who the imposter is before the result.
      expect(xv.imp!.result).toBeNull();
      expect(JSON.stringify(xv.imp)).not.toContain('imposterId');
    };
    check();
    expect(v(t, x).mode).toBe('imposteur');
    expect(v(t, x).imp).toMatchObject({ manche: 1, manches: 3, tableRounds: 2, tableRound: 1, currentDrawer: null });
    expire(t);
    check();
    expect(v(t, x).imp!.currentDrawer).toBe(imp(t).order[0]);
    expect(v(t, imp(t).order[0]!).isDrawer).toBe(true);
    while (t.s.phase === 'impDrawing') { drawTurn(t); check(); }
    send(t, { type: 'impSkip', by: 'A' });
    check();
    send(t, { type: 'impVote', by: x, target: imposterId });
    check();
    const xv = v(t, x).imp!;
    expect(xv.voted).toEqual([x]);
    expect(xv.myVote).toBe(imposterId);
    const yv = v(t, y).imp!;
    expect(yv.voted).toEqual([x]);
    expect(yv.myVote).toBeNull();
    expect(JSON.stringify(yv)).not.toContain('votes');
    send(t, { type: 'impVote', by: y, target: imposterId });
    send(t, { type: 'impVote', by: imposterId, target: x });
    expect(t.s.phase).toBe('impGuess');
    check();
    send(t, { type: 'impGuess', by: imposterId, text: 'ballon' });
    const res = v(t, imposterId).imp!;
    expect(res.word).toBe(SECRET);
    expect(res.result).toEqual({
      imposterId, accused: imposterId, guess: 'ballon', imposterWon: false,
      votes: { [x]: imposterId, [y]: imposterId, [imposterId]: x },
    });
    expect(v(t, x).imp!.result).toEqual(res.result);
  });

  it('classique views have no imposter data', () => {
    const s = reduce(initialState(), { type: 'start', by: 'A' }, { now: 1, rng: seeded(), room: mkRoom(), words }).state;
    const view = viewFor(s, 'B', 1, 'A');
    expect(view.imp).toBeNull();
    expect(view.mode).toBe('classique');
  });
});
