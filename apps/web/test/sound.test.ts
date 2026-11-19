import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal Web Audio stand-in: counts contexts and the sources each one starts. */
class FakeParam {
  value = 0;
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
}
class FakeNode {
  connect(n: unknown) { return n; }
  disconnect() {}
}
class FakeSource extends FakeNode {
  constructor(private ctx: FakeAudioContext) { super(); }
  frequency = new FakeParam();
  type = 'sine';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start() { this.ctx.started++; }
  stop() {}
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' = 'suspended';
  destination = new FakeNode();
  started = 0;
  resumed = 0;
  gains: { gain: FakeParam }[] = [];
  constructor() { FakeAudioContext.instances.push(this); }
  createGain() {
    const g = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(g);
    return g;
  }
  createOscillator() { return new FakeSource(this); }
  createBufferSource() { return new FakeSource(this); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() }); }
  createBuffer(_ch: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
}

type SoundModule = typeof import('../src/lib/sound');
let sound: SoundModule;

beforeEach(async () => {
  localStorage.clear();
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.resetModules();
  sound = await import('../src/lib/sound');
});

afterEach(() => {
  sound.stopTicking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sound settings', () => {
  it('defaults to volume 0.6, not muted', () => {
    expect(sound.getSoundSettings()).toEqual({ volume: 0.6, muted: false });
  });

  it('round-trips through localStorage kg.sound', () => {
    sound.setSoundSettings({ volume: 0.25, muted: true });
    expect(JSON.parse(localStorage.getItem('kg.sound')!)).toEqual({ volume: 0.25, muted: true });
    expect(sound.getSoundSettings()).toEqual({ volume: 0.25, muted: true });
  });

  it('clamps the volume and falls back on garbage', () => {
    sound.setSoundSettings({ volume: 7, muted: false });
    expect(sound.getSoundSettings().volume).toBe(1);
    sound.setSoundSettings({ volume: -2, muted: false });
    expect(sound.getSoundSettings().volume).toBe(0);
    expect(sound.setSoundSettings({ volume: 0.4, muted: false })).toEqual({ volume: 0.4, muted: false });
  });

  it('falls back on garbage saved values', async () => {
    for (const saved of ['{"volume":"loud","muted":"yes"}', 'not json']) {
      localStorage.setItem('kg.sound', saved);
      vi.resetModules();
      sound = await import('../src/lib/sound');
      expect(sound.getSoundSettings()).toEqual({ volume: 0.6, muted: false });
    }
  });

  it('follows a change made in another tab (storage event) and notifies subscribers', () => {
    const seen: unknown[] = [];
    const off = sound.onSoundSettings((s) => seen.push(s));
    localStorage.setItem('kg.sound', '{"volume":0.2,"muted":true}');
    window.dispatchEvent(new StorageEvent('storage', { key: 'kg.sound' }));
    expect(sound.getSoundSettings()).toEqual({ volume: 0.2, muted: true });
    expect(seen).toEqual([{ volume: 0.2, muted: true }]);
    window.dispatchEvent(new StorageEvent('storage', { key: 'kg.name' }));
    expect(seen).toHaveLength(1);
    off();
  });

  it('a storage event mutes a running context', () => {
    sound.play('submit');
    const master = FakeAudioContext.instances[0].gains[0];
    localStorage.setItem('kg.sound', '{"volume":0.6,"muted":true}');
    window.dispatchEvent(new StorageEvent('storage', { key: 'kg.sound' }));
    expect(master.gain.value).toBe(0);
    sound.play('submit');
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});

describe('play', () => {
  it('creates no AudioContext while muted', () => {
    sound.setSoundSettings({ volume: 0.6, muted: true });
    for (const name of ['tick', 'submit', 'found', 'close', 'reveal', 'timeUp', 'turnStart', 'podium'] as const) sound.play(name);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('creates one AudioContext lazily and starts sources for every sound', () => {
    expect(FakeAudioContext.instances).toHaveLength(0);
    for (const name of ['tick', 'submit', 'found', 'close', 'reveal', 'timeUp', 'turnStart', 'podium'] as const) {
      const ctx = FakeAudioContext.instances[0];
      const before = ctx?.started ?? 0;
      sound.play(name);
      expect(FakeAudioContext.instances).toHaveLength(1);
      expect(FakeAudioContext.instances[0].started).toBeGreaterThan(before);
    }
  });

  it('sets the master gain to the volume, and to 0 when muted later', () => {
    sound.setSoundSettings({ volume: 0.3, muted: false });
    sound.play('submit');
    const master = FakeAudioContext.instances[0].gains[0];
    expect(master.gain.value).toBeCloseTo(0.3);
    sound.setSoundSettings({ volume: 0.3, muted: true });
    expect(master.gain.value).toBe(0);
  });

  it('resumes the context on user gestures until it runs (click / touchend count, for iOS)', async () => {
    sound.play('tick');
    const ctx = FakeAudioContext.instances[0];
    window.dispatchEvent(new Event('touchend'));
    expect(ctx.resumed).toBe(1);
    await Promise.resolve();
    window.dispatchEvent(new Event('click'));
    window.dispatchEvent(new Event('keydown'));
    expect(ctx.resumed).toBe(1);
  });

  it('keeps listening while resume() leaves the context suspended', async () => {
    sound.play('tick');
    const ctx = FakeAudioContext.instances[0];
    ctx.resume = function () { this.resumed++; return Promise.resolve(); };
    window.dispatchEvent(new Event('click'));
    await Promise.resolve();
    window.dispatchEvent(new Event('pointerdown'));
    expect(ctx.resumed).toBe(2);
  });

  it('retries creating the context when the master gain setup failed', () => {
    const create = FakeAudioContext.prototype.createGain;
    FakeAudioContext.prototype.createGain = () => { throw new Error('nope'); };
    sound.play('submit');
    FakeAudioContext.prototype.createGain = create;
    sound.play('submit');
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioContext.instances[1].started).toBeGreaterThan(0);
  });
});

describe('ticking', () => {
  it('ticks at once, then every 1000 ms / rate, re-reading the rate on each tick', () => {
    vi.useFakeTimers();
    let rate = 1;
    sound.startTicking(() => rate);
    const ctx = FakeAudioContext.instances[0];
    const perTick = ctx.started;
    expect(perTick).toBeGreaterThan(0);
    vi.advanceTimersByTime(999);
    expect(ctx.started).toBe(perTick);
    vi.advanceTimersByTime(1);
    expect(ctx.started).toBe(2 * perTick);
    rate = 2; // the next tick is still 1000 ms away (scheduled with the old rate), the one after is 500 ms
    vi.advanceTimersByTime(1000);
    expect(ctx.started).toBe(3 * perTick);
    vi.advanceTimersByTime(500);
    expect(ctx.started).toBe(4 * perTick);
  });

  it('stopTicking clears the timer', () => {
    vi.useFakeTimers();
    sound.startTicking(() => 1);
    const ctx = FakeAudioContext.instances[0];
    const n = ctx.started;
    sound.stopTicking();
    vi.advanceTimersByTime(5000);
    expect(ctx.started).toBe(n);
  });

  it('a second startTicking replaces the first', () => {
    vi.useFakeTimers();
    sound.startTicking(() => 1);
    sound.startTicking(() => 1);
    const ctx = FakeAudioContext.instances[0];
    const perTick = ctx.started / 2;
    vi.advanceTimersByTime(1000);
    expect(ctx.started).toBe(3 * perTick);
  });

  it('ticks silently (no AudioContext) while muted', () => {
    vi.useFakeTimers();
    sound.setSoundSettings({ volume: 0.6, muted: true });
    sound.startTicking(() => 1);
    vi.advanceTimersByTime(3000);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});
