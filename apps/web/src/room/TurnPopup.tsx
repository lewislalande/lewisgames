import { useEffect } from 'react';
import { Dot } from '../pictionary/imposter/TurnBar';
import type { TurnPopupData } from './turnPopup';

export const TURN_POPUP_MS = 1400;

/**
 * Brief « à toi ! » card over the canvas. It never takes pointer events, and goes away at once when the
 * player starts drawing (pointerdown on the board) or after TURN_POPUP_MS.
 */
export function TurnPopup({ popup, onDone }: { popup: TurnPopupData; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, TURN_POPUP_MS);
    const down = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('canvas.board')) onDone();
    };
    document.addEventListener('pointerdown', down, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', down, true);
    };
  }, [popup.id]); // eslint-disable-line react-hooks/exhaustive-deps -- onDone only clears this popup
  return (
    <div className="turn-popup-backdrop" aria-hidden="true">
      <div className="turn-popup" data-turn-popup>
        <p className="turn-popup-title">{popup.title}</p>
        <p className="turn-popup-sub">
          {popup.color && <Dot color={popup.color} />}
          {popup.word ? <strong className="turn-popup-word">{popup.sub}</strong> : <span>{popup.sub}</span>}
        </p>
      </div>
    </div>
  );
}
