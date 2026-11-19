import { useEffect, useRef, useState } from 'react';
import { isBlankAnswer, type ClientMsg, type QuizView } from '@kg/shared';
import { QuizFoot } from './cards';

const MAX_ANSWER = 100;
/** Typing pause after which the text is sent without pressing Enter (the server accepts changes until the timer ends). */
const AUTOSEND_MS = 600;

type Props = { game: QuizView; connectedIds: string[]; send: (m: ClientMsg) => void };

/** Mounted once per question (keyed by the question number). */
export function Answering({ game, connectedIds, send }: Props) {
  const hasAnswer = !isBlankAnswer(game.myAnswer ?? '');
  const [text, setText] = useState(game.myAnswer ?? '');
  const [editing, setEditing] = useState(!hasAnswer);
  // What this page last sent: shown at once, before the server echoes it in myAnswer.
  const [sent, setSent] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastSent = useRef(game.myAnswer?.trim() ?? '');

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  // Text typed but not submitted must not be lost when the timer ends.
  useEffect(() => {
    const clean = text.trim();
    if (!editing || isBlankAnswer(text) || clean === lastSent.current) return;
    const id = setTimeout(() => {
      lastSent.current = clean;
      send({ t: 'answer', text: clean });
    }, AUTOSEND_MS);
    return () => clearTimeout(id);
  }, [text, editing, send]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isBlankAnswer(text)) return;
    const clean = text.trim();
    lastSent.current = clean;
    send({ t: 'answer', text: clean });
    setSent(clean);
    setEditing(false);
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
            <button className="btn" type="button" onClick={() => { setText(sent ?? game.myAnswer ?? ''); setEditing(true); }}>Modifier</button>
          </div>
        )}
      </div>
      <QuizFoot>
        {answeredNow}/{connectedIds.length} {answeredNow > 1 ? 'ont répondu' : 'a répondu'}
      </QuizFoot>
    </>
  );
}
