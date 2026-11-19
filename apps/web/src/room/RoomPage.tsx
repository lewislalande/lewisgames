import { useEffect, useState, type ReactNode } from 'react';
import type { GameKind } from '@kg/shared';
import { getName, setName } from '../lib/identity';
import { fetchRoomGame } from '../lib/rooms';
import { WrongGame } from './RoomError';

type Props = {
  code: string;
  game: GameKind;
  children: (name: string, onChangeName: () => void) => ReactNode;
};

/**
 * Shared entry of a room page: checks the room plays `game` (so a wrong link never joins the other
 * game's room), asks for a pseudo if needed, then renders the connected page.
 */
export function RoomPage({ code, game, children }: Props) {
  const [name, setNameState] = useState<string | null>(getName());
  // undefined: still asking. A failed lookup (offline, 404) falls through: the socket reports it.
  const [actual, setActual] = useState<GameKind | 'not_found' | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetchRoomGame(code).then((g) => { if (live) setActual(g); });
    return () => { live = false; };
  }, [code]);

  if (actual === undefined) {
    return (
      <main className="narrow">
        <p className="status">Connexion à la salle…</p>
      </main>
    );
  }
  if (actual !== null && actual !== 'not_found' && actual !== game) return <WrongGame code={code} expected={game} actual={actual} />;
  if (!name) {
    return (
      <NamePrompt
        code={code}
        onSubmit={(n) => {
          setName(n);
          setNameState(getName());
        }}
      />
    );
  }
  return <>{children(name, () => setNameState(null))}</>;
}

function NamePrompt({ code, onSubmit }: { code: string; onSubmit: (n: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <main className="narrow">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value);
        }}
      >
        <h1 className="title-sm">Salle {code}</h1>
        <label htmlFor="pseudo">Choisis ton pseudo</label>
        <input id="pseudo" className="text-input" value={value} maxLength={20} autoFocus autoComplete="off" onChange={(e) => setValue(e.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
          Entrer dans la salle
        </button>
      </form>
    </main>
  );
}
