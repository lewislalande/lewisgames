import { useEffect, useRef, useState } from 'react';
import { hintsUnlocked, isLetterIndex } from '@kg/shared';
import type { ClientMsg, PictionaryView } from '@kg/shared';
import { useServerNow } from './Timer';

const FRESH_MS = 1500;

/** Indices revealed since the last render pass, highlighted for FRESH_MS (not on mount/reconnect). */
function useFreshReveals(revealed: number[]): Set<number> {
  const seen = useRef(new Set(revealed));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const added = revealed.filter((i) => !seen.current.has(i));
    seen.current = new Set(revealed);
    if (added.length === 0) return;
    setFresh(new Set(added));
    // Not an effect cleanup: unrelated state messages re-run this effect and must not cancel it.
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFresh(new Set()), FRESH_MS);
  }, [revealed]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return fresh;
}

type Props = {
  game: PictionaryView;
  drawerName: string | null;
  offset: number;
  send: (m: ClientMsg) => void;
};

export function WordBar({ game, offset, send }: Props) {
  const now = useServerNow(offset, 500);
  const { phase, word, mask, revealed } = game;
  const fresh = useFreshReveals(revealed);

  // While choosing, the notebook title says who picks the word.
  if (phase === 'choosing' || (word === null && mask === null)) return <div className="wordbar" />;

  const shown = word ?? mask!.join('');
  const chars = [...shown];
  const letterCount = chars.filter((_, i) => isLetterIndex(shown, i)).length;
  const isShown = new Set(revealed);

  const interactive = game.isDrawer && game.phase === 'drawing' && word !== null;
  const unlocked =
    game.drawStartedAt !== null &&
    hintsUnlocked(now - game.drawStartedAt, game.settings.drawSeconds * 1000, game.settings.hintUnlockPct);

  return (
    <div className="wordbar">
      <div className="slots" aria-label={word !== null ? `Le mot : ${word}` : `Mot de ${letterCount} ${letterCount > 1 ? 'lettres' : 'lettre'}`}>
        {chars.map((ch, i) => {
          if (!isLetterIndex(shown, i)) return <span key={i} className="slot sep">{ch === ' ' ? ' ' : ch}</span>;
          const hinted = isShown.has(i);
          const cls = `slot${hinted ? ' revealed' : ''}${fresh.has(i) ? ' fresh' : ''}`;
          if (interactive) {
            const canClick = unlocked && game.hintsLeft > 0 && !hinted;
            return (
              <button
                key={i}
                type="button"
                className={`${cls} letter-btn`}
                disabled={!canClick}
                title={unlocked ? 'Révéler cette lettre' : "Les indices ne sont pas encore disponibles"}
                onClick={() => send({ t: 'reveal', index: i })}
              >
                {ch}
              </button>
            );
          }
          return <span key={i} className={cls}>{ch === '_' ? '' : ch}</span>;
        })}
      </div>
      {phase === 'drawing' && <span className="wordbar-note">{letterCount} {letterCount > 1 ? 'lettres' : 'lettre'}</span>}
      {interactive && <span className="wordbar-note" title={unlocked ? undefined : "Les indices ne sont pas encore disponibles"}>Indices restants : {game.hintsLeft}</span>}
    </div>
  );
}
