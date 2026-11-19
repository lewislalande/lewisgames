// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundControl } from '../src/room/SoundControl';
import { useStateChanges } from '../src/room/useStateChanges';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SoundControl', () => {
  it('follows a change made in another tab', () => {
    act(() => root.render(createElement(SoundControl)));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Son"]')!;
    expect(button.classList.contains('silent')).toBe(false);
    localStorage.setItem('kg.sound', '{"volume":0.6,"muted":true}');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'kg.sound' })); });
    expect(button.classList.contains('silent')).toBe(true);
    localStorage.setItem('kg.sound', '{"volume":0.6,"muted":false}');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'kg.sound' })); });
  });

  it('closes on a pointerdown outside, not when focus leaves', () => {
    act(() => root.render(createElement(SoundControl)));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Son"]')!;
    act(() => button.click());
    act(() => { (document.activeElement as HTMLElement).blur(); });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens a « Son » popover, saves the mute toggle, closes on Escape and refocuses the button', () => {
    act(() => root.render(createElement(SoundControl)));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Son"]')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Volume');
    expect(dialog.textContent).toContain('Couper le son');
    expect(document.activeElement).toBe(host.querySelector('input[type="range"]'));

    act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(JSON.parse(localStorage.getItem('kg.sound')!)).toEqual({ volume: 0.6, muted: true });
    expect(button.classList.contains('silent')).toBe(true);

    act(() => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

function Probe({ value, connected, onChange }: { value: number | null; connected: boolean; onChange: (a: number, b: number) => void }) {
  // Boxed so each render passes a distinct object, as each state message does.
  useStateChanges(value === null ? null : boxes(value), connected, (a, b) => onChange(a.n, b.n));
  return null;
}
const cache = new Map<number, { n: number }>();
const boxes = (n: number) => cache.get(n) ?? (cache.set(n, { n }), cache.get(n)!);

describe('useStateChanges', () => {
  it('fires on changes only, never for the first state nor the first one after a reconnect', () => {
    const onChange = vi.fn();
    const r = (value: number | null, connected: boolean) => act(() => root.render(createElement(Probe, { value, connected, onChange })));
    r(null, false);
    r(null, true);
    r(1, true); // first state: baseline
    expect(onChange).not.toHaveBeenCalled();
    r(2, true);
    expect(onChange).toHaveBeenLastCalledWith(1, 2);
    r(2, false); // connection lost, old state still shown
    r(2, true); // reopened, nothing new yet
    r(5, true); // fresh state after the reconnect: baseline, not a replay
    expect(onChange).toHaveBeenCalledTimes(1);
    r(6, true);
    expect(onChange).toHaveBeenLastCalledWith(5, 6);
  });
});
