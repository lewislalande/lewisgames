import { SELF, env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BASE, Client, createRoom, until } from './helpers';
import { markUsed, pickQuestions } from '../src/questions';
import type { QuizState, Room } from '@kg/shared';

afterEach(() => vi.restoreAllMocks());

const stubFor = (code: string) => env.ROOM.get(env.ROOM.idFromName(code));
const readAlarm = (code: string) => runInDurableObject(stubFor(code), (_i, state) => state.storage.getAlarm());

let seq = 0;
/** A theme no other test uses, so tests sharing the database stay independent. */
const freshTheme = () => `Thème ${++seq} ${crypto.randomUUID().slice(0, 6)}`;

async function seed(theme: string, rows: { question: string; answer: string; variants?: string[] }[]): Promise<void> {
  const now = Date.now();
  await env.DB.batch(rows.map((r) =>
    env.DB.prepare(
      'INSERT INTO questions (theme, question, question_key, answer, variants, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(theme, r.question, `${theme}|${r.question}`, r.answer, JSON.stringify(r.variants ?? []), now),
  ));
}

const lastUsed = async (theme: string): Promise<(number | null)[]> =>
  (await env.DB.prepare('SELECT last_used_at FROM questions WHERE theme = ?').bind(theme).all<{ last_used_at: number | null }>())
    .results.map((r) => r.last_used_at);

const three = (tag: string) => [
  { question: `Q1 ${tag} ?`, answer: `zzcorrect1${tag}`, variants: [`zzvariant1${tag}`] },
  { question: `Q2 ${tag} ?`, answer: `zzcorrect2${tag}` },
  { question: `Q3 ${tag} ?`, answer: `zzcorrect3${tag}` },
];

/** A quiz room with host A and guest B, the settings restricted to `theme`. */
async function quizRoom(theme: string) {
  const code = await createRoom('quiz');
  const { c: a, playerId: aId } = await Client.join(code, 'tok-a', 'A');
  const { c: b, playerId: bId } = await Client.join(code, 'tok-b', 'B');
  await a.nextQuiz((m) => m.players.length === 2);
  a.send({ t: 'settings', settings: { themes: [theme] } });
  await a.nextQuiz((m) => m.game.settings.themes[0] === theme);
  await b.nextQuiz((m) => m.game.settings.themes[0] === theme);
  return { code, a, aId, b, bId };
}

describe('quiz rooms', () => {
  it('creates a quiz room and sends quiz states', async () => {
    const code = await createRoom('quiz');
    expect(await (await SELF.fetch(`${BASE}/api/rooms/${code}`)).json()).toEqual({ game: 'quiz' });
    const { c: a, playerId: aId } = await Client.join(code, 'tok-a', 'A');
    const { c: b } = await Client.join(code, 'tok-b', 'B');
    const s = await b.nextQuiz((m) => m.players.length === 2);
    expect(s.kind).toBe('quiz');
    expect(s.hostId).toBe(aId);
    expect(s.game.phase).toBe('lobby');
    expect(s.game.settings.questionCount).toBe(15);
    void a;
  });

  it('starts with the available questions when there are fewer than questionCount, and marks them used', async () => {
    const theme = freshTheme();
    await seed(theme, three('start'));
    const { a, b } = await quizRoom(theme);
    a.send({ t: 'start' });
    const s = await b.nextQuiz((m) => m.game.phase === 'answering');
    expect(s.game.questionCount).toBe(3);
    expect(s.game.questionNumber).toBe(1);
    expect(s.game.question?.theme).toBe(theme);
    expect(s.game.question?.text).toMatch(/^Q\d start \?$/);
    expect(s.game.phaseEndsAt).not.toBeNull();

    // Marked after the state is delivered.
    const used = await until(() => lastUsed(theme), (v) => v.every((t) => t !== null));
    expect(used).toHaveLength(3);
  });

  it('keeps answers, the correct answer and scores secret until the review at the end', async () => {
    const theme = freshTheme();
    await seed(theme, [
      { question: 'Q secrète 1 ?', answer: 'zzcorrectsecret1', variants: ['zzvariantsecret1'] },
      { question: 'Q secrète 2 ?', answer: 'zzcorrectsecret2', variants: ['zzvariantsecret2'] },
    ]);
    const { code, a, aId, b, bId } = await quizRoom(theme);
    a.send({ t: 'start' });
    const first = await b.nextQuiz((m) => m.game.phase === 'answering');

    a.send({ t: 'answer', text: 'zzanswerofa1', final: true });
    const afterA = await b.nextQuiz((m) => m.game.answered.includes(aId));
    expect(afterA.game.myAnswer).toBeNull();
    // 1 of 2 submitted: the timer runs at ×2 and the alarm follows the new end time.
    expect(afterA.game.timeRate).toBe(2);
    expect(afterA.game.phaseEndsAt!).toBeLessThan(first.game.phaseEndsAt!);
    // Persisted after delivery: poll.
    await until(() => readAlarm(code), (t) => t === Math.ceil(afterA.game.phaseEndsAt!));
    // A sees their own answer.
    expect((await a.nextQuiz((m) => m.game.answered.includes(aId))).game.myAnswer).toBe('zzanswerofa1');

    b.send({ t: 'answer', text: 'zzanswerofb1', final: true });
    const transition = await b.nextQuiz((m) => m.game.phase === 'transition');
    expect(transition.game.phaseEndsAt! - transition.game.serverNow).toBeLessThanOrEqual(1000);
    // The transition timer opens question 2: reach into the instance's in-memory state (private
    // `data`) to make the 1 s transition already due, then fire the alarm instead of waiting.
    await runInDurableObject(stubFor(code), (instance) => {
      (instance as unknown as { data: { game: { phaseEndsAt: number } } }).data.game.phaseEndsAt = Date.now() - 1;
    });
    await runDurableObjectAlarm(stubFor(code));
    await b.nextQuiz((m) => m.game.phase === 'answering' && m.game.questionNumber === 2);
    a.send({ t: 'answer', text: 'zzanswerofa2', final: true });
    await b.nextQuiz((m) => m.game.answered.includes(aId));

    for (const [c, others] of [[a, ['zzanswerofb1']], [b, ['zzanswerofa1', 'zzanswerofa2']]] as const) {
      const raw = c.raw.join('\n');
      for (const secret of [...others, 'zzcorrectsecret', 'zzvariantsecret']) expect(raw).not.toContain(secret);
      for (const m of c.msgs) {
        if (m.t === 'state' && m.kind === 'quiz') expect(m.game.scores).toEqual({});
      }
    }

    b.send({ t: 'answer', text: 'zzanswerofb2', final: true });
    const review = await b.nextQuiz((m) => m.game.phase === 'voting');
    expect(review.game.questionNumber).toBe(1);
    expect(review.game.reviewing).toBe(true);
    expect(review.game.correct?.answer).toMatch(/^zzcorrectsecret[12]$/);
    expect(review.game.revealed.map((g) => g.text).sort()).toEqual(['zzanswerofa1', 'zzanswerofb1']);
    void bId;
  });

  describe('states stored before quiz v2', () => {
    type Stored = { room: Room; game: Record<string, unknown> };
    /** Rewrites the stored game in the previous format, then restarts the instance so it loads it. */
    async function storeLegacy(code: string, phase: string, keepAnswers = false): Promise<void> {
      await runInDurableObject(stubFor(code), async (_i, state) => {
        const stored = (await state.storage.get<Stored>('state'))!;
        const { allAnswers, reviewIndex: _r, timeRate: _t, ...rest } = stored.game as unknown as QuizState;
        const game = { ...rest, ...(keepAnswers ? { allAnswers } : {}), phase, revealedCount: 0, answerShown: false, phaseEndsAt: phase === 'answering' ? rest.phaseEndsAt : null };
        await state.storage.put('state', { ...stored, game });
      });
      await evictDurableObject(stubFor(code), { webSockets: 'hibernate' });
    }

    it('an answering game without timeRate (but with allAnswers) keeps working after a restart', async () => {
      const theme = freshTheme();
      await seed(theme, three('legacy-answering'));
      const { code, a, aId, b } = await quizRoom(theme);
      a.send({ t: 'start' });
      await b.nextQuiz((m) => m.game.phase === 'answering');
      await storeLegacy(code, 'answering', true);
      a.send({ t: 'answer', text: 'zzlegacy', final: true });
      const s = await b.nextQuiz((m) => m.game.answered.includes(aId));
      expect(s.game.timeRate).toBe(2);
      expect(Number.isFinite(s.game.phaseEndsAt)).toBe(true);
      await until(() => readAlarm(code), (t) => t === Math.ceil(s.game.phaseEndsAt!));
    });

    it('a game in the removed reveal phase ends, and the host can restart', async () => {
      const theme = freshTheme();
      await seed(theme, three('legacy-reveal'));
      const { code, a, b } = await quizRoom(theme);
      a.send({ t: 'start' });
      await b.nextQuiz((m) => m.game.phase === 'answering');
      await storeLegacy(code, 'revealing');
      a.send({ t: 'restart' });
      const s = await b.nextQuiz((m) => m.game.phase === 'lobby');
      expect(s.game.settings.themes).toEqual([theme]);
      expect(await readAlarm(code)).toBeNull();
    });
  });

  it('never shows a final:false draft in other players\' frames, nor counts it as answered', async () => {
    const theme = freshTheme();
    await seed(theme, [{ question: 'Q brouillon ?', answer: 'zzcorrectdraft' }]);
    const { a, aId, b } = await quizRoom(theme);
    a.send({ t: 'start' });
    await b.nextQuiz((m) => m.game.phase === 'answering');

    a.send({ t: 'answer', text: 'zzdraftofa' });
    expect((await a.nextQuiz((m) => m.game.myAnswer === 'zzdraftofa')).game.mySubmitted).toBe(false);
    // B's own draft frame arrives after everything A's draft caused for B.
    b.send({ t: 'answer', text: 'zzdraftofb', final: false });
    await b.nextQuiz((m) => m.game.myAnswer === 'zzdraftofb');
    expect(b.raw.join('\n')).not.toContain('zzdraftofa');
    expect(b.raw.join('\n')).not.toContain('"answered":["' + aId);
    expect(a.raw.join('\n')).not.toContain('zzdraftofb');
  });

  it('tells the host about a D1 failure at start instead of ignoring it', async () => {
    const { a, b } = await quizRoom(freshTheme());
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('d1 down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    a.send({ t: 'start' });
    expect(await a.next((m) => m.t === 'error')).toEqual({ t: 'error', code: 'internal' });
    vi.restoreAllMocks();
    // Non-fatal: the room is still in the lobby and the socket still open.
    a.send({ t: 'settings', settings: { answerSeconds: 25 } });
    expect((await a.nextQuiz((m) => m.game.settings.answerSeconds === 25)).game.phase).toBe('lobby');
    expect(a.closed).toBeNull();
    void b;
  });

  it('refuses to start when the chosen themes have no question, telling the host only', async () => {
    const { a, b } = await quizRoom(freshTheme());
    a.send({ t: 'start' });
    expect(await a.next((m) => m.t === 'error')).toEqual({ t: 'error', code: 'no_questions' });
    // The socket stays open and the room stays in the lobby.
    a.send({ t: 'settings', settings: { answerSeconds: 20 } });
    const s = await a.nextQuiz((m) => m.game.settings.answerSeconds === 20);
    expect(s.game.phase).toBe('lobby');
    expect(a.closed).toBeNull();
    await b.nextQuiz((m) => m.game.settings.answerSeconds === 20);
    expect(b.msgs.some((m) => m.t === 'error')).toBe(false);
  });

  it('ignores a start from a guest', async () => {
    const theme = freshTheme();
    await seed(theme, three('guest'));
    const { a, b } = await quizRoom(theme);
    b.send({ t: 'start' });
    a.send({ t: 'settings', settings: { answerSeconds: 25 } });
    const s = await b.nextQuiz((m) => m.game.settings.answerSeconds === 25);
    expect(s.game.phase).toBe('lobby');
    expect(b.msgs.some((m) => m.t === 'error')).toBe(false);
    expect(await lastUsed(theme)).toEqual([null, null, null]);
  });

  it('answers a message of another game with bad_message without closing', async () => {
    const { a } = await quizRoom(freshTheme());
    a.send({ t: 'draw', op: { op: 'undo' } });
    expect(await a.next((m) => m.t === 'error')).toEqual({ t: 'error', code: 'bad_message' });
    a.send({ t: 'settings', settings: { answerSeconds: 40 } });
    await a.nextQuiz((m) => m.game.settings.answerSeconds === 40);
    expect(a.closed).toBeNull();
  });

  it('caps joins at the quiz maxPlayers', async () => {
    const code = await createRoom('quiz');
    const { c: a } = await Client.join(code, 'tok-a', 'A');
    a.send({ t: 'settings', settings: { maxPlayers: 2 } });
    await a.nextQuiz((m) => m.game.settings.maxPlayers === 2);
    await Client.join(code, 'tok-b', 'B');
    const c = await Client.open(code);
    c.send({ t: 'hello', token: 'tok-c', name: 'C' });
    expect(await c.next((m) => m.t === 'error')).toEqual({ t: 'error', code: 'room_full' });
  });
});

describe('pictionary words', () => {
  it('draws the word choices from the words table', async () => {
    const words = ['zzmotun', 'zzmotdeux', 'zzmottrois', 'zzmotquatre'];
    await env.DB.batch(words.map((w) => env.DB.prepare('INSERT INTO words (word) VALUES (?)').bind(w)));
    try {
      const code = await createRoom('pictionary');
      const { c: a } = await Client.join(code, 'tok-a', 'A');
      await Client.join(code, 'tok-b', 'B');
      await a.nextState((m) => m.players.length === 2);
      a.send({ t: 'start' });
      const s = await a.nextState((m) => m.game.phase === 'choosing');
      expect(s.game.wordChoices).toHaveLength(3);
      for (const w of s.game.wordChoices!) expect(words).toContain(w);
    } finally {
      await env.DB.prepare('DELETE FROM words').run();
    }
  });

  it('rejects a quiz message in a pictionary room with bad_message', async () => {
    const code = await createRoom('pictionary');
    const { c: a } = await Client.join(code, 'tok-a', 'A');
    a.send({ t: 'answer', text: 'x', final: true });
    expect(await a.next((m) => m.t === 'error')).toEqual({ t: 'error', code: 'bad_message' });
    expect(a.closed).toBeNull();
  });
});

describe('questions store', () => {
  it('picks never-used questions first, then the least recently used', async () => {
    const theme = freshTheme();
    await seed(theme, three('lru'));
    const all = await pickQuestions(env.DB, [theme], 10);
    expect(all).toHaveLength(3);
    const [first, second, third] = all;
    await markUsed(env.DB, [first!.id], 1000);
    await markUsed(env.DB, [second!.id], 2000);
    const again = await pickQuestions(env.DB, [theme], 2);
    expect(again.map((q) => q.id)).toEqual([third!.id, first!.id]);
    expect(all.find((q) => q.answer === 'zzcorrect1lru')?.variants).toEqual(['zzvariant1lru']);
    expect(all.find((q) => q.answer === 'zzcorrect2lru')?.variants).toEqual([]);
  });

  it('lists themes with their question counts', async () => {
    const t1 = freshTheme();
    const t2 = freshTheme();
    await seed(t1, three('t1'));
    await seed(t2, three('t2').slice(0, 1));
    const res = await SELF.fetch(`${BASE}/api/themes`);
    expect(res.status).toBe(200);
    const themes = (await res.json()) as { theme: string; count: number }[];
    expect(themes).toContainEqual({ theme: t1, count: 3 });
    expect(themes).toContainEqual({ theme: t2, count: 1 });
  });
});
