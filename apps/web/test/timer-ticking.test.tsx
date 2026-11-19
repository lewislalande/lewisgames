// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sound = vi.hoisted(() => ({ startTicking: vi.fn(), stopTicking: vi.fn() }));
vi.mock('../src/lib/sound', () => sound);
const { Timer } = await import('../src/pictionary/Timer');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  sound.startTicking.mockClear();
  sound.stopTicking.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

type P = { endsAt: number | null; rate?: number; ticking?: boolean; fastEnd?: boolean };
const render = (p: P) => act(() => root.render(createElement(Timer, { offset: 0, ...p })));
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('Timer ticking', () => {
  it('starts once in the last 10 displayed seconds and stops on unmount', () => {
    const endsAt = Date.now() + 15_000;
    render({ endsAt, ticking: true });
    advance(4_500);
    expect(sound.startTicking).not.toHaveBeenCalled();
    advance(1_000); // 9.5 s left → shows 10
    expect(sound.startTicking).toHaveBeenCalledTimes(1);
    advance(3_000);
    expect(sound.startTicking).toHaveBeenCalledTimes(1);
    const stops = sound.stopTicking.mock.calls.length;
    act(() => root.render(createElement('div')));
    expect(sound.stopTicking.mock.calls.length).toBeGreaterThan(stops);
  });

  it('stops when the phase stops ticking (ticking → false)', () => {
    render({ endsAt: Date.now() + 8_000, ticking: true });
    expect(sound.startTicking).toHaveBeenCalledTimes(1);
    const stops = sound.stopTicking.mock.calls.length;
    render({ endsAt: Date.now() + 8_000, ticking: false });
    expect(sound.stopTicking.mock.calls.length).toBeGreaterThan(stops);
  });

  it('stops at zero', () => {
    render({ endsAt: Date.now() + 2_000, ticking: true });
    sound.stopTicking.mockClear();
    advance(2_000);
    expect(sound.stopTicking).toHaveBeenCalled();
  });

  it('never ticks without `ticking`', () => {
    render({ endsAt: Date.now() + 5_000 });
    advance(6_000);
    expect(sound.startTicking).not.toHaveBeenCalled();
  });

  it('counts displayed time (× rate) and reads the live rate', () => {
    render({ endsAt: Date.now() + 6_000, rate: 2, ticking: true }); // 12 s shown
    expect(sound.startTicking).not.toHaveBeenCalled();
    advance(1_250); // 9.5 s shown
    expect(sound.startTicking).toHaveBeenCalledTimes(1);
    const getRate = sound.startTicking.mock.calls[0][0] as () => number;
    expect(getRate()).toBe(2);
    render({ endsAt: Date.now() + 3_000, rate: 3, ticking: true }); // rate grew (server rescaled endsAt)
    expect(getRate()).toBe(3);
    expect(sound.startTicking).toHaveBeenCalledTimes(1);
  });

  it('fastEnd doubles the pace and marks urgency in the last 3 s', () => {
    render({ endsAt: Date.now() + 9_000, ticking: true, fastEnd: true });
    const [getRate, isUrgent] = sound.startTicking.mock.calls[0] as [() => number, () => boolean];
    expect(getRate()).toBe(1);
    expect(isUrgent()).toBe(false);
    advance(6_500);
    expect(getRate()).toBe(2);
    expect(isUrgent()).toBe(true);
  });
});
