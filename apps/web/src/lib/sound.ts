/**
 * Game sound effects, synthesized with the Web Audio API (no audio files). The AudioContext is
 * created lazily on the first sound played while not muted, and resumed on the first user gesture
 * (browsers keep a context created without one suspended).
 */

export type SoundName = 'tick' | 'submit' | 'found' | 'close' | 'reveal' | 'timeUp' | 'turnStart' | 'podium';
export type SoundSettings = { volume: number; muted: boolean };

const KEY = 'kg.sound';
const DEFAULTS: SoundSettings = { volume: 0.6, muted: false };

const clampVolume = (v: number) => Math.min(1, Math.max(0, v));

/** The saved setting, the defaults when nothing (or garbage) is saved. */
export function getSoundSettings(): SoundSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS };
    const { volume, muted } = raw as Record<string, unknown>;
    return {
      volume: typeof volume === 'number' && Number.isFinite(volume) ? clampVolume(volume) : DEFAULTS.volume,
      muted: typeof muted === 'boolean' ? muted : DEFAULTS.muted,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSoundSettings(s: SoundSettings): void {
  const clean: SoundSettings = { volume: clampVolume(Number.isFinite(s.volume) ? s.volume : DEFAULTS.volume), muted: s.muted };
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Storage full or blocked: the setting still applies to this page.
  }
  settings = clean;
  if (master) master.gain.value = clean.muted ? 0 : clean.volume;
}

let settings: SoundSettings = getSoundSettings();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = settings.muted ? 0 : settings.volume;
  master.connect(ctx.destination);
  return ctx;
}

// Resume on the first gesture anywhere; the listener stays until it has a context to resume.
if (typeof window !== 'undefined') {
  const onGesture = () => {
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}

type Wave = OscillatorType;

/** One oscillator note: quick attack, exponential decay. `to` glides the pitch. */
function tone(c: AudioContext, at: number, freq: number, dur: number, peak: number, type: Wave = 'sine', to?: number) {
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(master!);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** A band-passed noise burst; `to` sweeps the band (a swoosh). */
function burst(c: AudioContext, at: number, freq: number, dur: number, peak: number, q = 4, to?: number) {
  if (!noise) {
    noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noise;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = q;
  band.frequency.setValueAtTime(freq, at);
  if (to !== undefined) band.frequency.exponentialRampToValueAtTime(to, at + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + (to === undefined ? 0.003 : dur * 0.6));
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(band).connect(env).connect(master!);
  src.start(at);
  src.stop(at + dur + 0.02);
}

let tock = false;

/** Woodblock-ish click, alternating tick / tock; higher in the last seconds. */
function tick(c: AudioContext, t: number, urgent: boolean) {
  tock = !tock;
  const base = (urgent ? 1.45 : 1) * (tock ? 0.8 : 1);
  burst(c, t, 2400 * base, 0.045, 0.22, 6);
  tone(c, t, 1100 * base, 0.06, 0.12, 'sine');
}

const SOUNDS: Record<Exclude<SoundName, 'tick'>, (c: AudioContext, t: number) => void> = {
  // Soft two-note blip up.
  submit: (c, t) => {
    tone(c, t, 660, 0.09, 0.16, 'triangle');
    tone(c, t + 0.08, 990, 0.14, 0.16, 'triangle');
  },
  // Bright arpeggio C6 E6 G6.
  found: (c, t) => {
    [1047, 1319, 1568].forEach((f, i) => tone(c, t + i * 0.07, f, i === 2 ? 0.24 : 0.14, 0.15, 'triangle'));
  },
  // « Hmm »: two notes down.
  close: (c, t) => {
    tone(c, t, 523, 0.12, 0.15, 'sine');
    tone(c, t + 0.12, 415, 0.18, 0.15, 'sine');
  },
  // Soft pop.
  reveal: (c, t) => tone(c, t, 700, 0.08, 0.14, 'sine', 320),
  // Short descending buzzer, low-passed so it stays soft.
  timeUp: (c, t) => {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(master!);
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.exponentialRampToValueAtTime(165, t + 0.36);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
    env.gain.setValueAtTime(0.12, t + 0.22);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    osc.connect(env).connect(lp);
    osc.start(t);
    osc.stop(t + 0.4);
  },
  // Rising swoosh.
  turnStart: (c, t) => {
    burst(c, t, 350, 0.32, 0.2, 2, 3200);
    tone(c, t + 0.05, 330, 0.3, 0.06, 'sine', 660);
  },
  // Short fanfare: C5 E5 G5, then a held C6 (≈ 1 s).
  podium: (c, t) => {
    const notes: [number, number, number][] = [[523, 0, 0.14], [659, 0.13, 0.14], [784, 0.26, 0.14], [1047, 0.42, 0.6]];
    for (const [f, at, dur] of notes) {
      tone(c, t + at, f, dur, 0.14, 'triangle');
      tone(c, t + at, f, dur, 0.035, 'square');
    }
  },
};

function playAt(name: SoundName, urgent = false): void {
  if (settings.muted) return;
  const c = context();
  if (!c || !master) return;
  try {
    const t = c.currentTime + 0.005;
    if (name === 'tick') tick(c, t, urgent);
    else SOUNDS[name](c, t);
  } catch {
    // A sound must never break the game.
  }
}

export function play(name: SoundName): void {
  playAt(name, false);
}

let tickTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Ticks now, then every 1000 ms / getRate() (re-read on each tick, so a rate change applies to the
 * next interval). `isUrgent` makes the tick higher (the last seconds). Replaces any running ticking.
 */
export function startTicking(getRate: () => number, isUrgent: () => boolean = () => false): void {
  stopTicking();
  const step = () => {
    playAt('tick', isUrgent());
    const rate = getRate();
    tickTimer = setTimeout(step, 1000 / (Number.isFinite(rate) && rate > 0 ? rate : 1));
  };
  step();
}

export function stopTicking(): void {
  clearTimeout(tickTimer);
  tickTimer = undefined;
}
