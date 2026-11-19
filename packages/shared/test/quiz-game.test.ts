import { describe, it, expect } from 'vitest';
import {
  quizReduce, quizInitialState, quizViewFor, clampQuizSettings,
  type Question, type QuizCtx, type QuizEvent, type QuizState,
} from '../src';
import { disconnect, type Room } from '../src/room';

const mkRoom = (ids = ['A', 'B', 'C']): Room => ({
  code: 'ABCDE', game: 'pictionary', hostId: 'A', ownerId: 'A', tokens: {},
  players: ids.map((id, i) => ({ id, name: id, connected: true, joinedAt: i })),
});

const reconnect = (room: Room, id: string): Room => ({
  ...room, players: room.players.map((p) => (p.id === id ? { ...p, connected: true } : p)),
});

const q = (id: number): Question => ({
  id, theme: `T${id}`, question: `Q${id}?`, answer: `R${id}`, variants: [`V${id}`],
});

const ctxOf = (room: Room, now = 1000): QuizCtx => ({ now, room });

function run(s: QuizState, events: QuizEvent[], room = mkRoom(), now = 1000): QuizState {
  return events.reduce((st, e) => quizReduce(st, e, ctxOf(room, now)).state, s);
}

const started = (room = mkRoom(), questions = [q(1), q(2)]) =>
  run(quizInitialState(), [{ type: 'start', by: 'A', questions }], room);

const answerAll = (s: QuizState, texts: Record<string, string>, room = mkRoom()) =>
  run(s, Object.entries(texts).map(([by, text]) => ({ type: 'answer', by, text }) as QuizEvent), room);

const nexts = (s: QuizState, n: number, room = mkRoom()) =>
  run(s, Array.from({ length: n }, () => ({ type: 'next', by: 'A' }) as QuizEvent), room);

/** Answers, reveals everything and opens the vote. */
function toVoting(texts: Record<string, string>, room = mkRoom()): QuizState {
  const s = answerAll(started(room), texts, room);
  return nexts(s, s.groups.length + 2, room);
}

describe('start', () => {
  it('ignores a non-host', () => {
    const s = quizInitialState();
    const r = quizReduce(s, { type: 'start', by: 'B', questions: [q(1)] }, ctxOf(mkRoom()));
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);
  });
  it('ignores 0 questions', () => {
    const s = quizInitialState();
    const r = quizReduce(s, { type: 'start', by: 'A', questions: [] }, ctxOf(mkRoom()));
    expect(r.state.phase).toBe('lobby');
    expect(r.effects).toEqual([]);
  });
  it('ignores fewer than 2 connected players', () => {
    const room = disconnect(mkRoom(['A', 'B']), 'B');
    expect(run(quizInitialState(), [{ type: 'start', by: 'A', questions: [q(1)] }], room).phase).toBe('lobby');
  });
  it('starts answering with a timer, zero scores, and caps questions at questionCount', () => {
    const settings = clampQuizSettings({ questionCount: 5, answerSeconds: 20 });
    const qs = Array.from({ length: 8 }, (_, i) => q(i + 1));
    const r = quizReduce(quizInitialState(settings), { type: 'start', by: 'A', questions: qs }, ctxOf(mkRoom(), 500));
    expect(r.effects).toEqual([{ type: 'state' }]);
    expect(r.state.phase).toBe('answering');
    expect(r.state.questions).toHaveLength(5);
    expect(r.state.index).toBe(0);
    expect(r.state.phaseEndsAt).toBe(500 + 20000);
    expect(r.state.scores).toEqual({ A: 0, B: 0, C: 0 });
  });
});

describe('answering', () => {
  it('replaces trimmed answers and ignores over-long ones', () => {
    let s = run(started(), [
      { type: 'answer', by: 'B', text: '  foo ' },
      { type: 'answer', by: 'B', text: 'bar' },
      { type: 'answer', by: 'C', text: 'x'.repeat(101) },
    ]);
    expect(s.answers).toEqual({ B: 'bar' });
    s = run(s, [{ type: 'answer', by: 'C', text: 'y'.repeat(100) }]);
    expect(s.answers.C).toHaveLength(100);
  });
  it('ends early when every connected player answered', () => {
    const s = answerAll(started(), { A: 'a', B: 'b', C: 'c' });
    expect(s.phase).toBe('revealing');
    expect(s.groups.map((g) => g.authors)).toEqual([['A'], ['B'], ['C']]);
    expect(s.revealedCount).toBe(0);
    expect(s.phaseEndsAt).toBeNull();
  });
  it('an empty answer does not count as answered', () => {
    const s = answerAll(started(), { A: 'a', B: '   ', C: 'c' });
    expect(s.phase).toBe('answering');
    expect(quizViewFor(s, 'A', 1000).answered).toEqual(['A', 'C']);
  });
  it('stale timeout is ignored, due timeout ends answering', () => {
    const s = started();
    const early = quizReduce(s, { type: 'timeout' }, ctxOf(mkRoom(), s.phaseEndsAt! - 1));
    expect(early.state).toBe(s);
    expect(early.effects).toEqual([]);
    const due = quizReduce(s, { type: 'timeout' }, ctxOf(mkRoom(), s.phaseEndsAt!));
    expect(due.state.phase).toBe('revealing');
    // A timeout outside answering does nothing.
    const later = quizReduce(due.state, { type: 'timeout' }, ctxOf(mkRoom(), 10 ** 9));
    expect(later.state).toBe(due.state);
  });
  it('answer survives reconnect', () => {
    let room = mkRoom();
    let s = run(started(room), [{ type: 'answer', by: 'B', text: 'paris' }], room);
    room = disconnect(room, 'B');
    s = run(s, [{ type: 'playerLeft', playerId: 'B' }], room);
    room = reconnect(room, 'B');
    s = run(s, [{ type: 'playerJoined', playerId: 'B' }], room);
    expect(s.phase).toBe('answering');
    expect(quizViewFor(s, 'B', 1000).myAnswer).toBe('paris');
    s = run(s, [{ type: 'answer', by: 'B', text: 'lyon' }], room);
    expect(quizViewFor(s, 'B', 1000).myAnswer).toBe('lyon');
    expect(s.scores.B).toBe(0);
  });
  it('a player leaving can complete the answering phase', () => {
    let room = mkRoom();
    const s = answerAll(started(room), { A: 'a', B: 'b' }, room);
    room = disconnect(room, 'C');
    expect(run(s, [{ type: 'playerLeft', playerId: 'C' }], room).phase).toBe('revealing');
  });
  it('a player joining mid-game gets score 0 and can answer', () => {
    const room = mkRoom(['A', 'B', 'C', 'D']);
    let s = started(mkRoom());
    s = run(s, [{ type: 'playerJoined', playerId: 'D' }, { type: 'answer', by: 'D', text: 'd' }], room);
    expect(s.scores.D).toBe(0);
    expect(s.answers.D).toBe('d');
  });
  it('views hide other answers and the correct answer', () => {
    const s = run(started(), [{ type: 'answer', by: 'B', text: 'secretanswer' }]);
    const a = quizViewFor(s, 'A', 1000);
    expect(JSON.stringify(a)).not.toContain('secretanswer');
    expect(JSON.stringify(a)).not.toContain('R1');
    expect(a.correct).toBeNull();
    expect(a.myAnswer).toBeNull();
    expect(a.answered).toEqual(['B']);
    expect(a.question).toEqual({ theme: 'T1', text: 'Q1?' });
    expect(a.questionNumber).toBe(1);
    expect(a.questionCount).toBe(2);
    expect(quizViewFor(s, 'B', 1000).myAnswer).toBe('secretanswer');
  });
});

describe('revealing', () => {
  it('reveals step by step, then the answer, then opens the vote', () => {
    let s = answerAll(started(), { A: 'a', B: 'b', C: 'c' });
    expect(quizViewFor(s, 'B', 1000).revealed).toEqual([]);
    s = nexts(s, 1);
    expect(quizViewFor(s, 'B', 1000).revealed).toEqual([{ groupId: 'a', text: 'a', authors: ['A'] }]);
    s = nexts(s, 2);
    expect(quizViewFor(s, 'B', 1000).revealed).toHaveLength(3);
    expect(quizViewFor(s, 'A', 1000).correct).toBeNull();
    s = nexts(s, 1);
    expect(s.answerShown).toBe(true);
    expect(quizViewFor(s, 'A', 1000).correct).toEqual({ answer: 'R1', variants: ['V1'] });
    expect(s.phase).toBe('revealing');
    s = nexts(s, 1);
    expect(s.phase).toBe('voting');
  });
  it('next by a non-host is ignored', () => {
    const s = answerAll(started(), { A: 'a', B: 'b', C: 'c' });
    const r = quizReduce(s, { type: 'next', by: 'B' }, ctxOf(mkRoom()));
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);
  });
  it('identical answers share one group', () => {
    const s = answerAll(started(), { A: 'Paris', B: ' paris ', C: 'Lyon' });
    expect(s.groups).toEqual([
      { id: 'paris', text: 'Paris', authors: ['A', 'B'] },
      { id: 'lyon', text: 'Lyon', authors: ['C'] },
    ]);
  });
  it('with no answers: show answer, then straight to result', () => {
    let s = run(started(), [{ type: 'timeout' }], mkRoom(), 10 ** 9);
    expect(s.groups).toEqual([]);
    s = nexts(s, 1);
    expect(s.answerShown).toBe(true);
    s = nexts(s, 1);
    expect(s.phase).toBe('result');
    expect(s.questionPoints).toEqual({ A: 0, B: 0, C: 0 });
  });
});

describe('voting', () => {
  it('ignores votes on own group, unknown groups and by disconnected players', () => {
    let room = mkRoom();
    const s = toVoting({ A: 'a', B: 'b', C: 'c' }, room);
    expect(s.phase).toBe('voting');
    room = disconnect(room, 'C');
    for (const e of [
      { type: 'vote', by: 'A', groupId: 'a', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'zzz', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'a', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'b', vote: 'maybe' },
    ] as QuizEvent[]) {
      const r = quizReduce(s, e, ctxOf(room));
      expect(r.state).toBe(s);
      expect(r.effects).toEqual([]);
    }
  });
  it('vote counts are hidden during voting; pendingVoters lists who still has to vote', () => {
    const s = run(toVoting({ A: 'a', B: 'b', C: 'c' }), [
      { type: 'vote', by: 'B', groupId: 'a', vote: 'no' },
      { type: 'vote', by: 'B', groupId: 'a', vote: 'yes' },
      { type: 'vote', by: 'B', groupId: 'c', vote: 'yes' },
    ]);
    const vb = quizViewFor(s, 'B', 1000);
    expect(vb.myVotes).toEqual({ a: 'yes', c: 'yes' });
    expect(vb.voteCounts).toBeNull();
    expect(vb.pendingVoters).toEqual(['A', 'C']);
    expect(quizViewFor(s, 'A', 1000).myVotes).toEqual({});
  });
  it('completes when all eligible voters voted, with points', () => {
    const s = run(toVoting({ A: 'a', B: 'b', C: 'c' }), [
      { type: 'vote', by: 'B', groupId: 'a', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'a', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'b', vote: 'no' },
      { type: 'vote', by: 'C', groupId: 'b', vote: 'no' },
      { type: 'vote', by: 'A', groupId: 'c', vote: 'half' },
      { type: 'vote', by: 'B', groupId: 'c', vote: 'half' },
    ]);
    expect(s.phase).toBe('result');
    expect(s.outcomes).toEqual({ a: 'yes', b: 'no', c: 'half' });
    expect(s.questionPoints).toEqual({ A: 1, B: 0, C: 0.5 });
    expect(s.scores).toEqual({ A: 1, B: 0, C: 0.5 });
    const v = quizViewFor(s, 'B', 1000);
    expect(v.voteCounts).toEqual({
      a: { yes: 2, half: 0, no: 0 }, b: { yes: 0, half: 0, no: 2 }, c: { yes: 0, half: 2, no: 0 },
    });
  });
  it('disconnected voters are not awaited', () => {
    let room = mkRoom();
    let s = run(toVoting({ A: 'x', B: 'y', C: 'z' }, room), [
      { type: 'vote', by: 'C', groupId: 'x', vote: 'yes' },
    ], room);
    room = disconnect(room, 'C');
    s = run(s, [{ type: 'playerLeft', playerId: 'C' }], room);
    expect(s.phase).toBe('voting');
    s = run(s, [
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'y', vote: 'no' },
    ], room);
    expect(s.phase).toBe('voting');
    s = run(s, [
      { type: 'vote', by: 'A', groupId: 'z', vote: 'yes' },
      { type: 'vote', by: 'B', groupId: 'z', vote: 'yes' },
    ], room);
    expect(s.phase).toBe('result');
    expect(s.outcomes).toEqual({ x: 'yes', y: 'no', z: 'yes' });
    expect(s.scores.C).toBe(1);
  });
  it('a voter leaving can complete the vote', () => {
    let room = mkRoom();
    let s = run(toVoting({ A: 'x', B: 'y', C: 'z' }, room), [
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'y', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'y', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'z', vote: 'yes' },
    ], room);
    expect(s.phase).toBe('voting');
    room = disconnect(room, 'B');
    s = run(s, [{ type: 'playerLeft', playerId: 'B' }], room);
    expect(s.phase).toBe('result');
  });
  it('tie on a group authored by the host resolves to half without deciding', () => {
    const s = run(toVoting({ A: 'x', B: 'y', C: 'y' }), [
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'x', vote: 'no' },
      { type: 'vote', by: 'A', groupId: 'y', vote: 'yes' },
    ]);
    expect(s.phase).toBe('result');
    expect(s.outcomes).toEqual({ x: 'half', y: 'yes' });
    expect(s.questionPoints).toEqual({ A: 0.5, B: 1, C: 1 });
  });
  it('tie on a non-host group goes to deciding; only the host decides', () => {
    let s = run(toVoting({ A: 'x', B: 'y', C: 'x' }), [
      { type: 'vote', by: 'A', groupId: 'y', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'y', vote: 'no' },
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
    ]);
    expect(s.phase).toBe('deciding');
    expect(s.outcomes).toEqual({ x: 'yes' });
    const v = quizViewFor(s, 'B', 1000);
    expect(v.ties).toEqual(['y']);
    expect(v.voteCounts).toEqual({ x: { yes: 1, half: 0, no: 0 }, y: { yes: 1, half: 0, no: 1 } });
    const ignored = quizReduce(s, { type: 'decide', by: 'B', groupId: 'y', vote: 'yes' }, ctxOf(mkRoom()));
    expect(ignored.state).toBe(s);
    expect(quizReduce(s, { type: 'decide', by: 'A', groupId: 'x', vote: 'no' }, ctxOf(mkRoom())).state).toBe(s);
    s = run(s, [{ type: 'decide', by: 'A', groupId: 'y', vote: 'no' }]);
    expect(s.phase).toBe('result');
    expect(s.outcomes).toEqual({ x: 'yes', y: 'no' });
    expect(s.questionPoints).toEqual({ A: 1, B: 0, C: 1 });
  });
  it('closeVote resolves on the votes cast so far', () => {
    let s = run(toVoting({ A: 'x', B: 'y', C: 'z' }), [
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'y', vote: 'no' },
      { type: 'vote', by: 'A', groupId: 'z', vote: 'half' },
    ]);
    expect(quizReduce(s, { type: 'closeVote', by: 'B' }, ctxOf(mkRoom())).state).toBe(s);
    s = run(s, [{ type: 'closeVote', by: 'A' }]);
    expect(s.phase).toBe('result');
    expect(s.outcomes).toEqual({ x: 'yes', y: 'no', z: 'half' });
  });
  it('a group nobody can vote on is a tie, half when the host is an author', () => {
    const room = mkRoom(['A', 'B']);
    const s = toVoting({ A: 'same', B: 'Same' }, room);
    expect(s.phase).toBe('result');
    expect(s.outcomes).toEqual({ same: 'half' });
    expect(s.scores).toEqual({ A: 0.5, B: 0.5 });
  });
  it('host leaves during voting: a tie on the new host\'s group resolves to half', () => {
    let room = mkRoom();
    let s = run(toVoting({ A: 'x', B: 'y', C: 'z' }, room), [
      { type: 'vote', by: 'A', groupId: 'y', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'y', vote: 'no' },
    ], room);
    room = disconnect(room, 'A');
    expect(room.hostId).toBe('B');
    s = run(s, [
      { type: 'playerLeft', playerId: 'A' },
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'B', groupId: 'z', vote: 'no' },
    ], room);
    expect(s.phase).toBe('result');
    expect(s.outcomes).toEqual({ x: 'yes', y: 'half', z: 'no' });
  });
  it('host leaves during deciding: a pending tie on the new host\'s group resolves to half', () => {
    let room = mkRoom();
    let s = run(toVoting({ A: 'x', B: 'y', C: 'x' }, room), [
      { type: 'vote', by: 'A', groupId: 'y', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'y', vote: 'no' },
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
    ], room);
    expect(s.phase).toBe('deciding');
    room = disconnect(room, 'A');
    const r = quizReduce(s, { type: 'playerLeft', playerId: 'A' }, ctxOf(room));
    expect(r.effects).toEqual([{ type: 'state' }]);
    expect(r.state.phase).toBe('result');
    expect(r.state.outcomes).toEqual({ x: 'yes', y: 'half' });
    expect(r.state.questionPoints).toEqual({ A: 1, B: 0.5, C: 1 });
  });
  it('whitespace-only and punctuation-only answers: not answered, no group, 0 points', () => {
    let s = run(started(), [
      { type: 'answer', by: 'A', text: 'x' },
      { type: 'answer', by: 'B', text: '   ' },
      { type: 'answer', by: 'C', text: '?!' },
    ]);
    expect(s.phase).toBe('answering');
    expect(quizViewFor(s, 'A', 1000).answered).toEqual(['A']);
    expect(quizViewFor(s, 'C', 1000).myAnswer).toBe('?!');
    s = run(s, [{ type: 'timeout' }], mkRoom(), 10 ** 9);
    expect(s.groups.map((g) => g.id)).toEqual(['x']);
    s = nexts(s, 3);
    s = run(s, [
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'x', vote: 'yes' },
    ]);
    expect(s.phase).toBe('result');
    expect(s.questionPoints).toEqual({ A: 1, B: 0, C: 0 });
  });
  it('empty answer gets 0 and no group', () => {
    let s = run(started(), [
      { type: 'answer', by: 'A', text: 'x' },
      { type: 'answer', by: 'B', text: 'y' },
      { type: 'timeout' },
    ], mkRoom(), 10 ** 9);
    expect(s.groups.map((g) => g.id)).toEqual(['x', 'y']);
    s = nexts(s, 4);
    s = run(s, [
      { type: 'vote', by: 'B', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'x', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'y', vote: 'yes' },
      { type: 'vote', by: 'C', groupId: 'y', vote: 'yes' },
    ]);
    expect(s.phase).toBe('result');
    expect(s.questionPoints).toEqual({ A: 1, B: 1, C: 0 });
  });
});

describe('full game', () => {
  it('plays 2 questions to gameOver with expected scores, then restarts keeping settings', () => {
    const settings = clampQuizSettings({ questionCount: 5, answerSeconds: 15 });
    let s = run(quizInitialState(settings), [{ type: 'start', by: 'A', questions: [q(1), q(2)] }]);
    // Q1: A and B right, C wrong.
    s = answerAll(s, { A: 'r', B: 'R', C: 'w' });
    s = nexts(s, 4);
    s = run(s, [
      { type: 'vote', by: 'C', groupId: 'r', vote: 'yes' },
      { type: 'vote', by: 'A', groupId: 'w', vote: 'no' },
      { type: 'vote', by: 'B', groupId: 'w', vote: 'no' },
    ]);
    expect(s.phase).toBe('result');
    expect(s.scores).toEqual({ A: 1, B: 1, C: 0 });
    s = nexts(s, 1, mkRoom());
    expect(s.phase).toBe('answering');
    expect(s.index).toBe(1);
    expect(s.answers).toEqual({});
    expect(s.groups).toEqual([]);
    expect(s.votes).toEqual({});
    expect(s.outcomes).toEqual({});
    expect(s.answerShown).toBe(false);
    expect(quizViewFor(s, 'A', 1000).question).toEqual({ theme: 'T2', text: 'Q2?' });
    // Q2: only C answers (half).
    s = run(s, [{ type: 'answer', by: 'C', text: 'c' }, { type: 'timeout' }], mkRoom(), 10 ** 9);
    s = nexts(s, 3);
    s = run(s, [
      { type: 'vote', by: 'A', groupId: 'c', vote: 'half' },
      { type: 'vote', by: 'B', groupId: 'c', vote: 'half' },
    ]);
    expect(s.questionPoints).toEqual({ A: 0, B: 0, C: 0.5 });
    s = nexts(s, 1);
    expect(s.phase).toBe('gameOver');
    expect(s.scores).toEqual({ A: 1, B: 1, C: 0.5 });
    expect(quizViewFor(s, 'B', 1000).scores).toEqual({ A: 1, B: 1, C: 0.5 });
    // restart
    expect(quizReduce(s, { type: 'restart', by: 'B' }, ctxOf(mkRoom())).state).toBe(s);
    s = run(s, [{ type: 'restart', by: 'A' }]);
    expect(s.phase).toBe('lobby');
    expect(s.settings).toEqual(settings);
    expect(s.scores).toEqual({});
  });
  it('setSettings only by the host in lobby/gameOver, clamped', () => {
    const s = run(quizInitialState(), [{ type: 'setSettings', by: 'A', settings: { questionCount: 999 } }]);
    expect(s.settings.questionCount).toBe(50);
    expect(run(s, [{ type: 'setSettings', by: 'B', settings: { questionCount: 5 } }])).toBe(s);
    const playing = started();
    expect(run(playing, [{ type: 'setSettings', by: 'A', settings: { questionCount: 5 } }])).toBe(playing);
  });
  it('setSettings merges a partial payload over the current settings', () => {
    let s = run(quizInitialState(), [
      { type: 'setSettings', by: 'A', settings: { questionCount: 20, answerSeconds: 60, themes: ['Histoire'] } },
    ]);
    s = run(s, [{ type: 'setSettings', by: 'A', settings: { answerSeconds: 45 } }]);
    expect(s.settings).toEqual({ questionCount: 20, answerSeconds: 45, maxPlayers: 8, themes: ['Histoire'] });
  });
  it('playerJoined / playerLeft always report a state change', () => {
    const s = quizInitialState();
    expect(quizReduce(s, { type: 'playerJoined', playerId: 'B' }, ctxOf(mkRoom())).effects).toEqual([{ type: 'state' }]);
    const room = disconnect(mkRoom(), 'C');
    expect(quizReduce(started(), { type: 'playerLeft', playerId: 'C' }, ctxOf(room)).effects).toEqual([{ type: 'state' }]);
  });
  it('host-only events are ignored when there is no host', () => {
    const room = { ...mkRoom(), hostId: null };
    const s = quizInitialState();
    expect(quizReduce(s, { type: 'start', by: 'A', questions: [q(1)] }, ctxOf(room)).state).toBe(s);
  });
});
