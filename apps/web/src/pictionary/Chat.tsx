import { useEffect, useRef, useState } from 'react';
import type { ClientMsg, PictionaryView } from '@kg/shared';

type Props = {
  game: PictionaryView;
  names: Record<string, string>;
  send: (m: ClientMsg) => void;
  onNotice: (cb: (n: 'close' | 'correct') => void) => () => void;
};

const CLOSE_MS = 2000;
const REVEAL_NOTE_MS = 5000;
/** Local-only lines (never sent): a revealed letter (fades), or this player's own close guess (kept for the turn). */
type LocalNote = { key: number; afterId: number; text: string; close?: boolean };

export function Chat({ game, names, send, onNotice }: Props) {
  const [text, setText] = useState('');
  const [close, setClose] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const revealedCount = useRef(game.revealed.length);
  const noteKey = useRef(0);
  // The last guess this page sent: the server's « close » notice is about it.
  const lastGuess = useRef<string | null>(null);
  const lastIdRef = useRef(0);

  // Local lines belong to one turn.
  const turn = `${game.round}:${game.drawerId}`;
  useEffect(() => {
    setNotes([]);
    lastGuess.current = null;
  }, [turn]);

  useEffect(() => {
    const off = onNotice((n) => {
      if (n !== 'close') return;
      const guess = lastGuess.current;
      if (guess !== null) {
        lastGuess.current = null;
        const note: LocalNote = { key: ++noteKey.current, afterId: lastIdRef.current, text: `${guess} — tu chauffes !`, close: true };
        setNotes((ns) => [...ns, note]);
      }
      setClose(true);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setClose(false), CLOSE_MS);
    });
    return () => {
      off();
      clearTimeout(closeTimer.current);
    };
  }, [onNotice]);

  // Client-side only: tell guessers a letter was just revealed (spec §7.4). Not on mount/reconnect.
  const last = game.chat[game.chat.length - 1]?.id;
  lastIdRef.current = last ?? 0;
  useEffect(() => {
    const n = game.revealed.length;
    const grew = n > revealedCount.current;
    revealedCount.current = n;
    if (!grew || game.isDrawer || game.phase !== 'drawing') return;
    const note: LocalNote = { key: ++noteKey.current, afterId: last ?? 0, text: 'Une lettre a été révélée' };
    setNotes((ns) => [...ns, note]);
    setTimeout(() => setNotes((ns) => ns.filter((x) => x.key !== note.key)), REVEAL_NOTE_MS);
  }, [game.revealed.length, game.isDrawer, game.phase, last]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last, notes.length]);

  const canGuess = game.phase === 'drawing' && !game.isDrawer && !game.hasFound;
  const inputRef = useRef<HTMLInputElement>(null);
  const couldGuess = useRef(canGuess);
  useEffect(() => {
    // Disabled inputs lose focus: take it back when guessing opens up again.
    if (canGuess && !couldGuess.current) inputRef.current?.focus();
    couldGuess.current = canGuess;
  }, [canGuess]);
  const placeholder = game.hasFound
    ? 'Tu as trouvé !'
    : game.isDrawer && game.phase === 'drawing'
      ? 'Tu dessines !'
      : game.phase === 'drawing'
        ? 'Ta réponse…'
        : 'Attends le prochain dessin…';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !canGuess) return;
    lastGuess.current = t;
    send({ t: 'guess', text: t });
    setText('');
  };

  const noteLine = (n: LocalNote) => (
    <li key={`n${n.key}`} className={n.close ? 'chat-local chat-close-guess' : 'chat-sys chat-local'}>{n.text}</li>
  );

  return (
    <section className="card chat">
      <h2>Chat</h2>
      <ul className="chat-list" ref={listRef} aria-live="polite">
        {game.chat.flatMap((c, idx) => {
          const line =
            c.kind === 'system' ? (
              <li key={c.id} className="chat-sys">{c.text}</li>
            ) : (
              <li key={c.id}>
                <strong>{(c.playerId && names[c.playerId]) ?? '?'}</strong> {c.text}
              </li>
            );
          const next = game.chat[idx + 1]?.id ?? Infinity;
          const after = notes.filter((n) => (idx === 0 || n.afterId >= c.id) && n.afterId < next);
          return [line, ...after.map(noteLine)];
        })}
        {game.chat.length === 0 && notes.map(noteLine)}
      </ul>
      <form className="chat-form" onSubmit={submit}>
        {close && <p className="chat-close" role="status">tu chauffes !</p>}
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          aria-label="Ta réponse"
          placeholder={placeholder}
          value={text}
          maxLength={100}
          disabled={!canGuess}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </section>
  );
}
