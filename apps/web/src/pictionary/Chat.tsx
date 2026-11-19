import { useEffect, useRef, useState } from 'react';
import type { ClientMsg, PictionaryView } from '@kg/shared';

type Props = {
  game: PictionaryView;
  names: Record<string, string>;
  send: (m: ClientMsg) => void;
  onNotice: (cb: (n: 'close' | 'correct') => void) => () => void;
};

const CLOSE_MS = 2000;

export function Chat({ game, names, send, onNotice }: Props) {
  const [text, setText] = useState('');
  const [close, setClose] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const off = onNotice((n) => {
      if (n !== 'close') return;
      setClose(true);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setClose(false), CLOSE_MS);
    });
    return () => {
      off();
      clearTimeout(closeTimer.current);
    };
  }, [onNotice]);

  const last = game.chat[game.chat.length - 1]?.id;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

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
    send({ t: 'guess', text: t });
    setText('');
  };

  return (
    <section className="card chat">
      <h2>Chat</h2>
      <ul className="chat-list" ref={listRef} aria-live="polite">
        {game.chat.map((c) =>
          c.kind === 'system' ? (
            <li key={c.id} className="chat-sys">{c.text}</li>
          ) : (
            <li key={c.id}>
              <strong>{(c.playerId && names[c.playerId]) ?? '?'}</strong> {c.text}
            </li>
          ),
        )}
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
