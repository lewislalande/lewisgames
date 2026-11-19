import { useEffect, useState } from 'react';

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

export function Timer({ endsAt, offset }: { endsAt: number | null; offset: number }) {
  const now = useServerNow(offset);
  if (endsAt === null) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <div className={`timer${left <= 10 ? ' urgent' : ''}`} role="timer" aria-label="Temps restant">
      {left}
      <small>s</small>
    </div>
  );
}
