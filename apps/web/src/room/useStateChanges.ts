import { useEffect, useRef } from 'react';

/**
 * Calls `onChange(prev, next)` for each new game state received while connected. The first state
 * after mounting or (re)connecting is only a baseline: what changed while away is never replayed.
 */
export function useStateChanges<T>(value: T | null, connected: boolean, onChange: (prev: T, next: T) => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  // `stale`: the state held when the connection dropped, still shown until the server sends a fresh one.
  const r = useRef<{ prev: T | null; stale: T | null }>({ prev: null, stale: null });
  useEffect(() => {
    const s = r.current;
    if (!connected) {
      s.prev = null;
      s.stale = value;
      return;
    }
    if (value === null || value === s.stale) return;
    const prev = s.prev;
    s.prev = value;
    if (prev !== null && prev !== value) cb.current(prev, value);
  }, [value, connected]);
}
