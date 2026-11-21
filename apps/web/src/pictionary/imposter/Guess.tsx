import { useState } from 'react';
import type { ClientMsg, ImposterView } from '@kg/shared';

type Props = { imp: ImposterView; names: Record<string, string>; send: (m: ClientMsg) => boolean };

/** The unmasked imposter's last chance: guess the word. */
export function Guess({ imp, names, send }: Props) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const name = imp.accused ? names[imp.accused] ?? '?' : '?';
  if (!imp.isImposter) {
    return (
      <section className="card imp-phase" aria-label="Dernière chance">
        <h2>Démasqué</h2>
        <p className="imp-accused">{name} est démasqué ! Il tente de deviner le mot…</p>
      </section>
    );
  }
  return (
    <section className="card imp-phase" aria-label="Dernière chance">
      <h2>Démasqué</h2>
      <p className="imp-accused">Tu es démasqué !</p>
      <form
        className="guess-form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || sent) return;
          if (send({ t: 'impGuess', text: t })) setSent(true);
        }}
      >
        <label htmlFor="imp-guess">Quel était le mot ?</label>
        <input id="imp-guess" type="text" value={text} maxLength={100} autoFocus autoComplete="off" disabled={sent} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={sent || !text.trim()}>Valider</button>
      </form>
    </section>
  );
}
