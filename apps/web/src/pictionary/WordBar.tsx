import { hintsUnlocked, isLetterIndex } from '@kg/shared';
import type { ClientMsg, PictionaryView } from '@kg/shared';
import { useServerNow } from './Timer';

type Props = {
  game: PictionaryView;
  drawerName: string | null;
  offset: number;
  send: (m: ClientMsg) => void;
};

export function WordBar({ game, drawerName, offset, send }: Props) {
  const now = useServerNow(offset, 500);
  const { phase, word, mask, revealed } = game;

  if (phase === 'choosing') {
    return <div className="wordbar"><span className="wordbar-note">{game.isDrawer ? 'Choisis un mot' : `${drawerName ?? 'Le dessinateur'} choisit un mot…`}</span></div>;
  }
  if (word === null && mask === null) return <div className="wordbar" />;

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
      <div className="slots" aria-label={word !== null ? `Le mot : ${word}` : `Mot de ${letterCount} lettres`}>
        {chars.map((ch, i) => {
          if (!isLetterIndex(shown, i)) return <span key={i} className="slot sep">{ch === ' ' ? ' ' : ch}</span>;
          const hinted = isShown.has(i);
          const cls = `slot${hinted ? ' revealed' : ''}`;
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
      {phase === 'drawing' && <span className="wordbar-note">{letterCount} lettres</span>}
      {interactive && <span className="wordbar-note" title={unlocked ? undefined : "Les indices ne sont pas encore disponibles"}>Indices restants : {game.hintsLeft}</span>}
    </div>
  );
}
