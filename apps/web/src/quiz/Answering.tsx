import { useEffect, useRef, useState } from 'react';
import { isBlankAnswer, type ClientMsg, type QuizView } from '@kg/shared';
import { QuizFoot } from './cards';

const MAX_ANSWER = 100;
/** Typing pause after which the text is sent without pressing Enter (the server accepts changes until the timer ends). */
const AUTOSEND_MS = 600;

type Props = {
  game: QuizView;
  connectedIds: string[];
  /** True if the message went out (the socket was open). */
  send: (m: ClientMsg) => boolean;
  /** Socket open: when it comes back, the current text is sent again if the server may not have it. */
  online?: boolean;
};

/** Mounted once per question (keyed by the question number). */
export function Answering({ game, connectedIds, send, online = true }: Props) {
  // « Envoyée » only when the server has it as submitted: after a refresh a draft is shown as a draft.
  const [text, setText] = useState(game.myAnswer ?? '');
  const [editing, setEditing] = useState(!game.mySubmitted);
  // What this page last sent: shown at once, before the server echoes it in myAnswer.
  const [sent, setSent] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastSent = useRef(game.myAnswer?.trim() ?? '');

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  // Text typed but not submitted is sent as a draft: the server uses it if the timer ends, but it does not count as answered.
  useEffect(() => {
    const clean = text.trim();
    if (!online || !editing || isBlankAnswer(text) || clean === lastSent.current) return;
    const id = setTimeout(() => {
      // A dropped message (socket not open) is retried when the socket comes back (`online`).
      if (send({ t: 'answer', text: clean, final: false })) lastSent.current = clean;
    }, AUTOSEND_MS);
    return () => clearTimeout(id);
  }, [text, editing, send, online]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isBlankAnswer(text)) return;
    const clean = text.trim();
    // Offline: stay in the form, the text is sent as soon as the connection is back.
    if (!send({ t: 'answer', text: clean, final: true })) return;
    lastSent.current = clean;
    setSent(clean);
    setEditing(false);
  }

  // « Modifier » withdraws the submission (the text stays as a draft); if the message is lost the autosend repeats it.
  function modify() {
    const shown = sent ?? game.myAnswer ?? '';
    lastSent.current = send({ t: 'answer', text: shown, final: false }) ? shown.trim() : '';
    setText(shown);
    setEditing(true);
  }

  // Only players still connected count, so the figure never exceeds the total.
  const answeredNow = game.answered.filter((id) => connectedIds.includes(id)).length;

  return (
    <>
      <div className="qz-page qz-page-center">
        <p className="qz-question">{game.question?.text}</p>
        {editing ? (
          <form className="qz-answer-form" onSubmit={submit}>
            <label htmlFor="qz-input" className="sr-only">Ta réponse</label>
            <input
              id="qz-input"
              ref={input}
              className="text-input qz-input"
              value={text}
              maxLength={MAX_ANSWER}
              placeholder="Ta réponse…"
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={isBlankAnswer(text)}>Envoyer</button>
          </form>
        ) : (
          <div className="qz-sent">
            <p className="qz-sent-title">Réponse envoyée ✓</p>
            <p className="qz-sent-text">{sent ?? game.myAnswer}</p>
            <button className="btn" type="button" onClick={modify}>Modifier</button>
          </div>
        )}
      </div>
      <QuizFoot>
        {answeredNow}/{connectedIds.length} {answeredNow > 1 ? 'ont répondu' : 'a répondu'}
      </QuizFoot>
    </>
  );
}
