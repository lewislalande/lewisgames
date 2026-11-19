import { useMemo, useState } from 'react';
import { getName, setName } from '../lib/identity';
import { useRoomSocket } from '../lib/socket';
import { Lobby } from '../pictionary/Lobby';
import { Scoreboard } from '../pictionary/Scoreboard';
import { DrawingCanvas } from '../pictionary/DrawingCanvas';
import { DEFAULT_TOOL_STATE } from '../pictionary/Toolbar';
import type { ToolState } from '../pictionary/Toolbar';
import { WordBar } from '../pictionary/WordBar';
import { Timer } from '../pictionary/Timer';
import { Chat } from '../pictionary/Chat';
import { WordChoice } from '../pictionary/WordChoice';
import { TurnEnd } from '../pictionary/TurnEnd';
import { GameOver } from '../pictionary/GameOver';

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
  // Drawing tool settings live here so they persist across turns (the canvas remounts each turn).
  const [tools, setTools] = useState<ToolState>(DEFAULT_TOOL_STATE);
  // Server clock offset, re-measured on every state message.
  const offset = useMemo(() => (state ? state.game.serverNow - Date.now() : 0), [state]);
  const names = useMemo(() => Object.fromEntries((state?.players ?? []).map((p) => [p.id, p.name])), [state]);

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
  const drawerName = game.drawerId ? names[game.drawerId] ?? null : null;
  const playing = game.phase === 'choosing' || game.phase === 'drawing' || game.phase === 'turnEnd';
  return (
    <main className={`room${game.phase === 'lobby' ? '' : ' wide'}`}>
      {sock.status !== 'open' && <p className="banner">Connexion perdue, nouvelle tentative…</p>}
      {game.phase === 'lobby' && <Lobby code={code} state={state} playerId={sock.playerId} send={sock.send} />}
      {game.phase === 'gameOver' && <GameOver state={state} playerId={sock.playerId} send={sock.send} />}
      {playing && (
        <>
          <header className="topbar card">
            <span className="round">Manche {game.round}/{game.settings.rounds}</span>
            <WordBar game={game} drawerName={drawerName} offset={offset} send={sock.send} />
            <Timer endsAt={game.phaseEndsAt} offset={offset} />
          </header>
          <div className="game-grid">
            <Scoreboard state={state} playerId={sock.playerId} />
            <section className="card stage">
              <div className="stage-canvas">
                <DrawingCanvas
                  key={`${game.round}:${game.drawerId}`}
                  history={game.history}
                  canDraw={game.isDrawer && game.phase === 'drawing'}
                  onOp={(op) => sock.send({ t: 'draw', op })}
                  subscribe={sock.onDraw}
                  connected={sock.status === 'open'}
                  tools={tools}
                  onTools={setTools}
                />
                {game.phase === 'choosing' && <WordChoice game={game} drawerName={drawerName} send={sock.send} />}
                {game.phase === 'turnEnd' && <TurnEnd game={game} names={names} />}
              </div>
            </section>
            <Chat game={game} names={names} send={sock.send} onNotice={sock.onNotice} />
          </div>
        </>
      )}
    </main>
  );
}
