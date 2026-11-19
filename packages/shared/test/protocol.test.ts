import { describe, it, expect } from 'vitest';
import { MAX_CLIENT_MSG_LENGTH, parseClientMsg } from '../src/protocol';

describe('parseClientMsg', () => {
  it('parses each message type', () => {
    expect(parseClientMsg('{"t":"hello","token":"tk","name":"Ana"}')).toEqual({ t: 'hello', token: 'tk', name: 'Ana' });
    expect(parseClientMsg('{"t":"settings","settings":{"rounds":2}}')).toEqual({ t: 'settings', settings: { rounds: 2 } });
    expect(parseClientMsg('{"t":"start"}')).toEqual({ t: 'start' });
    expect(parseClientMsg('{"t":"restart","extra":1}')).toEqual({ t: 'restart' });
    expect(parseClientMsg('{"t":"choose","index":1}')).toEqual({ t: 'choose', index: 1 });
    expect(parseClientMsg('{"t":"reveal","index":0}')).toEqual({ t: 'reveal', index: 0 });
    expect(parseClientMsg('{"t":"guess","text":"chat"}')).toEqual({ t: 'guess', text: 'chat' });
    expect(parseClientMsg('{"t":"draw","op":{"op":"undo"}}')).toEqual({ t: 'draw', op: { op: 'undo' } });
  });

  it('parses the quiz messages', () => {
    expect(parseClientMsg('{"t":"answer","text":"Paris"}')).toEqual({ t: 'answer', text: 'Paris', final: false });
    expect(parseClientMsg('{"t":"answer","text":"Paris","final":true}')).toEqual({ t: 'answer', text: 'Paris', final: true });
    expect(parseClientMsg('{"t":"answer","text":"Paris","final":"yes"}')).toBeNull();
    expect(parseClientMsg('{"t":"next"}')).toEqual({ t: 'next' });
    expect(parseClientMsg('{"t":"closeVote"}')).toEqual({ t: 'closeVote' });
    expect(parseClientMsg('{"t":"vote","groupId":"paris","vote":"half"}')).toEqual({ t: 'vote', groupId: 'paris', vote: 'half' });
    expect(parseClientMsg('{"t":"decide","groupId":"paris","vote":"yes"}')).toEqual({ t: 'decide', groupId: 'paris', vote: 'yes' });
    for (const raw of [
      '{"t":"answer"}', '{"t":"answer","text":1}', '{"t":"vote","groupId":"g","vote":"maybe"}',
      '{"t":"vote","vote":"yes"}', '{"t":"decide","groupId":2,"vote":"no"}',
    ]) {
      expect(parseClientMsg(raw), raw).toBeNull();
    }
  });

  it('rejects malformed or mistyped input', () => {
    for (const raw of [
      '{nope', 'null', '[]', '"hello"', '{}', '{"t":"dance"}',
      '{"t":"hello","token":1,"name":"Ana"}', '{"t":"hello","token":"tk"}',
      '{"t":"settings"}', '{"t":"choose","index":"1"}', '{"t":"guess"}',
      '{"t":"draw","op":"undo"}', '{"t":"draw","op":{}}',
    ]) {
      expect(parseClientMsg(raw), raw).toBeNull();
    }
  });

  it('rejects oversized frames', () => {
    const raw = JSON.stringify({ t: 'guess', text: 'a'.repeat(MAX_CLIENT_MSG_LENGTH) });
    expect(parseClientMsg(raw)).toBeNull();
  });
});
