import { useEffect, useRef, useState } from 'react';
import { isBlankAnswer, type ClientMsg, type QuizView } from '@kg/shared';
import { QuizFoot } from './cards';

const MAX_ANSWER = 100;

type Props = { game: QuizView; connected: number; send: (m: ClientMsg) => void };

/** Mounted once per question (keyed by the question number). */
export function Answering({ game, connected, send }: Props) {
  const hasAnswer = !isBlankAnswer(game.myAnswer ?? '');
  const [text, setText] = useState(game.myAnswer ?? '');
  const [editing, setEditing] = useState(!hasAnswer);
  // What this page last sent: shown at once, before the server echoes it in myAnswer.
  const [sent, setSent] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isBlankAnswer(text)) return;
    const clean = text.trim();
    send({ t: 'answer', text: clean });
    setSent(clean);
    setEditing(false);
  }

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
        {game.answered.length}/{connected} {game.answered.length > 1 ? 'ont répondu' : 'a répondu'}
      </QuizFoot>
    </>
  );
}
