import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { PictionaryState, Room, ServerMsg } from '@kg/shared';
import { Client, createRoom, type StateMsg } from './helpers';

type Stored = { room: Room; game: PictionaryState };
const stubFor = (code: string) => env.ROOM.get(env.ROOM.idFromName(code));
const SECRET = 'zorglubium';

describe('pictionary imposter mode', () => {
  it('plays a manche over websockets without ever sending the word to the imposter', async () => {
    const code = await createRoom();
    const joined = [
      await Client.join(code, 'tok-a', 'A'),
      await Client.join(code, 'tok-b', 'B'),
      await Client.join(code, 'tok-c', 'C'),
    ];
    const byId = new Map(joined.map((j) => [j.playerId, j.c]));
    const a = joined[0]!.c;
    const all = joined.map((j) => j.c);
    await a.nextState((m) => m.players.length === 3);

    a.send({ t: 'settings', settings: { mode: 'imposteur', impTableRounds: 2 } });
    await a.nextState((m) => m.game.settings.mode === 'imposteur');
    a.send({ t: 'start' });
    for (const c of all) await c.nextState((m) => m.game.phase === 'impReveal');

    // Fix the secret word and end the reveal.
    const imposterId = await runInDurableObject(stubFor(code), (instance) => {
      const data = (instance as unknown as { data: Stored }).data;
      data.game.imp!.word = SECRET;
      data.game.phaseEndsAt = Date.now() - 1;
      return data.game.imp!.imposterId;
    });
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(true);
    let latest = await a.nextState((m) => m.game.phase === 'impDrawing');
    const imposter = byId.get(imposterId)!;
    const others = joined.filter((j) => j.playerId !== imposterId);

    for (let k = 1; k <= 6; k++) {
      const drawer = latest.game.imp!.currentDrawer!;
      const color = latest.game.imp!.colors[drawer]!;
      const dc = byId.get(drawer)!;
      // A non-current player tries to draw with their own colour: refused, never relayed.
      const intruder = joined.find((j) => j.playerId !== drawer)!;
      intruder.c.send({
        t: 'draw',
        op: { op: 'add', action: { id: `bad${k}`, kind: 'stroke', tool: 'pen', color: latest.game.imp!.colors[intruder.playerId], size: 6, opacity: 1, points: [[1, 1]] } },
      });
      const action = { id: `s${k}`, kind: 'stroke', tool: 'pen', color, size: 6, opacity: 1, points: [[10, 10], [20, 20]] };
      dc.send({ t: 'draw', op: { op: 'add', action } });
      for (const c of all) {
        if (c !== dc) expect(await c.next((m) => m.t === 'draw')).toEqual({ t: 'draw', op: { op: 'add', action } });
      }
      dc.send({ t: 'impDone' });
      for (const c of all) latest = await c.nextState((m) => m.game.history.actions.length === 1 + k);
    }
    expect(latest.game.phase).toBe('impDiscuss');
    for (const c of all) {
      // The drawer never gets its own ops echoed, and refused strokes are never relayed.
      const draws = c.msgs.filter((m): m is Extract<ServerMsg, { t: 'draw' }> => m.t === 'draw');
      expect(draws.every((m) => m.op.op === 'add' && !m.op.action.id.startsWith('bad'))).toBe(true);
    }
    expect(latest.game.history.actions.some((x) => x.id.startsWith('bad'))).toBe(false);
    expect(all.reduce((n, c) => n + c.msgs.filter((m) => m.t === 'draw').length, 0)).toBe(12);

    a.send({ t: 'impSkip' });
    for (const c of all) await c.nextState((m) => m.game.phase === 'impVote');
    for (const o of others) o.c.send({ t: 'impVote', target: imposterId });
    imposter.send({ t: 'impVote', target: others[0]!.playerId });
    for (const c of all) await c.nextState((m) => m.game.phase === 'impGuess');
    const beforeResult = imposter.raw.length;

    imposter.send({ t: 'impGuess', text: 'Zorglubium' });
    const res = await imposter.nextState((m) => m.game.phase === 'impResult');
    expect(res.game.imp!.word).toBe(SECRET);
    expect(res.game.imp!.result).toMatchObject({ imposterId, accused: imposterId, imposterWon: true });
    expect(res.game.scores[imposterId]).toBe(2);

    // Every frame the imposter got before the result is free of the word.
    for (const raw of imposter.raw.slice(0, beforeResult)) expect(raw.toLowerCase()).not.toContain(SECRET);
    const otherState = (await others[0]!.c.nextState((m) => m.game.phase === 'impResult')) as StateMsg;
    expect(otherState.game.imp!.result!.votes[imposterId]).toBe(others[0]!.playerId);
  });
});
