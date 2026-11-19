import { useState } from 'react';
import type { GameKind } from '@kg/shared';
import { roomPath } from '../lib/rooms';

/** Lobby header: the room code as tiles and a « Copier le lien » button. */
export function CodeHeader({ code, game }: { code: string; game: GameKind }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${location.origin}${roomPath(game, code)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copie ce lien :', url);
    }
  }

  return (
    <header className="lobby-head">
      <div>
        <p className="muted">Code de la salle</p>
        <div className="code-tiles" aria-label={`Code ${code}`}>
          {code.split('').map((c, i) => (
            <span key={i} className="tile">{c}</span>
          ))}
        </div>
      </div>
      <button className="btn" onClick={copy}>{copied ? 'Lien copié' : 'Copier le lien'}</button>
    </header>
  );
}
