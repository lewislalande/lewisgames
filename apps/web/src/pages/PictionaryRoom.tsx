import { useState } from 'react';
import { getName, setName } from '../lib/identity';
import { useRoomSocket } from '../lib/socket';
import { Lobby } from '../pictionary/Lobby';
import { Scoreboard } from '../pictionary/Scoreboard';
import { DrawingCanvas } from '../pictionary/DrawingCanvas';

const ERRORS: Record<string, string> = {
  room_full: 'Cette salle est pleine.',
  not_found: "Cette salle n'existe pas.",
  bad_name: 'Ce pseudo est invalide (1 à 20 caractères).',
  bad_token: 'Ton identifiant de joueur est invalide. Recharge la page.',
  bad_message: 'Une erreur est survenue. Recharge la page.',
};

export function PictionaryRoom({ code }: { code: string }) {
  const [name, setNameState] = useState<string | null>(getName());
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
  return <Connected code={code} name={name} onChangeName={() => setNameState(null)} />;
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

function Connected({ code, name, onChangeName }: { code: string; name: string; onChangeName: () => void }) {
  const sock = useRoomSocket(code, name);
  const { state, error } = sock;

  if (error) {
    return (
      <main className="narrow">
        <div className="card">
          <h1 className="title-sm">Oups</h1>
          <p className="error" role="alert">{ERRORS[error] ?? ERRORS.bad_message}</p>
          {error === 'bad_name' && (
            <button className="btn" onClick={onChangeName}>Changer de pseudo</button>
          )}
          <a className="btn btn-primary" href="/">Retour à l'accueil</a>
        </div>
      </main>
    );
  }

  if (!state || !sock.playerId) {
    return (
      <main className="narrow">
        <p className="status">{sock.status === 'closed' ? 'Connexion perdue, nouvelle tentative…' : 'Connexion à la salle…'}</p>
      </main>
    );
  }

  const game = state.game;
  return (
    <main className="room">
      {sock.status !== 'open' && <p className="banner">Connexion perdue, nouvelle tentative…</p>}
      {game.phase === 'lobby' ? (
        <Lobby code={code} state={state} playerId={sock.playerId} send={sock.send} />
      ) : (
        <div className="room-grid">
          <section className="card">
            <h1 className="title-sm">Partie en cours…</h1>
            {(game.phase === 'choosing' || game.phase === 'drawing' || game.phase === 'turnEnd') && (
              <DrawingCanvas
                key={`${game.round}:${game.drawerId}`}
                history={game.history}
                canDraw={game.isDrawer && game.phase === 'drawing'}
                onOp={(op) => sock.send({ t: 'draw', op })}
                subscribe={sock.onDraw}
              />
            )}
          </section>
          <Scoreboard state={state} playerId={sock.playerId} />
        </div>
      )}
    </main>
  );
}
