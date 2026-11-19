import { useEffect, useRef, useState } from 'react';
import { startTicking, stopTicking } from '../lib/sound';

/** Ticking covers the last displayed seconds of a timed phase. */
const TICK_FROM = 10;
/** The last seconds tick higher (and twice as fast with `fastEnd`). */
const URGENT_FROM = 3;

/** Server-corrected "now" (ms), refreshed every `everyMs`. `offset` = serverNow − Date.now(). */
export function useServerNow(offset: number, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), everyMs);
    return () => clearInterval(id);
  }, [offset, everyMs]);
  return now;
}

type Props = {
  endsAt: number | null;
  offset: number;
  /** Turns real time into displayed time: shown seconds = (endsAt − now) × rate. Default 1. */
  rate?: number;
  /** Tick during the last 10 displayed seconds (one tick per displayed second). */
  ticking?: boolean;
  /** Tick every half second during the last 3 seconds. */
  fastEnd?: boolean;
};

export function Timer({ endsAt, offset, rate = 1, ticking = false, fastEnd = false }: Props) {
  const now = useServerNow(offset);
  const left = endsAt === null ? 0 : Math.max(0, Math.ceil(((endsAt - now) * rate) / 1000));
  // The ticker reads the latest values on each tick (the rate may grow mid-countdown).
  const live = useRef({ endsAt, offset, rate, fastEnd });
  live.current = { endsAt, offset, rate, fastEnd };
  const tickNow = ticking && endsAt !== null && left > 0 && left <= TICK_FROM;

  useEffect(() => {
    if (!tickNow) return;
    const secondsLeft = () => {
      const l = live.current;
      return l.endsAt === null ? 0 : ((l.endsAt - (Date.now() + l.offset)) * l.rate) / 1000;
    };
    startTicking(
      () => live.current.rate * (live.current.fastEnd && secondsLeft() <= URGENT_FROM ? 2 : 1),
      () => secondsLeft() <= URGENT_FROM,
    );
    return stopTicking;
  }, [tickNow]);
  // Stop right at zero rather than at the next 250 ms refresh, so no tick lands after the end.
  useEffect(() => {
    if (!tickNow || endsAt === null) return;
    const id = setTimeout(stopTicking, Math.max(0, endsAt - (Date.now() + offset) - 30));
    return () => clearTimeout(id);
  }, [tickNow, endsAt, offset]);

  if (endsAt === null) return null;
  return (
    <div className={`timer${left <= 10 ? ' urgent' : ''}`} role="timer" aria-label="Temps restant">
      {left}
      <small>s</small>
    </div>
  );
}
