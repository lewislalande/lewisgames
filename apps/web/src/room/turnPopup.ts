import type { PictionaryView } from '@kg/shared';

/** What the « à toi ! » popup shows; `id` is unique per firing so a repeat restarts it. */
export type TurnPopupData = { id: number; title: string; sub: string; color?: string; word?: boolean };

/** Imposter turn identity: a new turn is a new (manche, tour de table, drawer). */
const impTurn = (g: PictionaryView) => (g.imp && g.phase === 'impDrawing' ? `${g.imp.manche}:${g.imp.tableRound}:${g.imp.currentDrawer}` : null);

/**
 * The popup for one Pictionary state change, or null: only when it becomes this player's own turn to
 * draw (imposter: a new turn of mine in `impDrawing`; Classique: `drawing` starts and I draw).
 */
export function turnPopup(a: PictionaryView, b: PictionaryView, playerId: string | null): Omit<TurnPopupData, 'id'> | null {
  if (!playerId) return null;
  if (b.imp) {
    const turn = impTurn(b);
    const color = b.imp.colors[playerId];
    if (turn === null || b.imp.currentDrawer !== playerId || !color || turn === impTurn(a)) return null;
    return { title: 'À toi de jouer !', sub: 'Un seul trait, dans ta couleur', color };
  }
  if (b.phase === 'drawing' && a.phase !== 'drawing' && b.isDrawer && b.word) {
    return { title: 'À toi de dessiner !', sub: b.word, word: true };
  }
  return null;
}
