// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuizView } from '@kg/shared';
import { Answering } from '../src/quiz/Answering';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const game = { question: { text: 'Quelle est la capitale ?' }, answered: [], myAnswer: null } as unknown as QuizView;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function render(send: (m: unknown) => boolean, online = true) {
  act(() => root.render(createElement(Answering, { game, connectedIds: ['a'], send: send as never, online })));
}
function type(text: string) {
  const input = host.querySelector('input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('Answering autosend', () => {
  it('sends once after 600 ms of typing pause', () => {
    const send = vi.fn(() => true);
    render(send);
    type('Paris');
    advance(599);
    expect(send).not.toHaveBeenCalled();
    advance(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ t: 'answer', text: 'Paris' });
    advance(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('Enter sends at once and cancels the pending autosend', () => {
    const send = vi.fn(() => true);
    render(send);
    type('Paris');
    advance(300);
    act(() => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(send).toHaveBeenCalledTimes(1);
    advance(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('unmounting cancels the pending autosend', () => {
    const send = vi.fn(() => true);
    render(send);
    type('Paris');
    advance(300);
    act(() => root.unmount());
    advance(5000);
    expect(send).not.toHaveBeenCalled();
    root = createRoot(host); // for afterEach
  });

  it('a dropped message is not remembered as sent and is resent when the socket is back', () => {
    const send = vi.fn(() => false);
    render(send, true);
    type('Paris');
    advance(600);
    expect(send).toHaveBeenCalledTimes(1);
    render(send, false);
    advance(5000);
    expect(send).toHaveBeenCalledTimes(1);
    send.mockImplementation(() => true);
    render(send, true);
    advance(600);
    expect(send).toHaveBeenCalledTimes(2);
    advance(5000);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
