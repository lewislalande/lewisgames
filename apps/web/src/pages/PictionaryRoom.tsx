import { useEffect, useMemo, useState } from 'react';
import { IMP_STROKE_SIZE, isImposterPhase } from '@kg/shared';
import type { ImposterView, PictionaryView } from '@kg/shared';
import { RoomError, WrongGame } from '../room/RoomError';
import { RoomPage } from '../room/RoomPage';
import { useRoomSocket } from '../lib/socket';
import type { PictionaryStateMsg, RoomSocket } from '../lib/socket';
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
import { SoundControl } from '../room/SoundControl';
import { useStateChanges } from '../room/useStateChanges';
import { play } from '../lib/sound';
import { pictionarySound } from '../room/gameSounds';
import { RoleCard, SecretLine } from '../pictionary/imposter/RoleCard';
import { TurnBar } from '../pictionary/imposter/TurnBar';
import { Discussion } from '../pictionary/imposter/Discussion';
import { Vote } from '../pictionary/imposter/Vote';
import { Guess } from '../pictionary/imposter/Guess';
import { ImpResult } from '../pictionary/imposter/ImpResult';

export function PictionaryRoom({ code }: { code: string }) {
  return (
    <RoomPage code={code} game="pictionary">
      {(name, onChangeName) => <Connected code={code} name={name} onChangeName={onChangeName} />}
    </RoomPage>
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
  useStateChanges(state?.kind === 'pictionary' ? state.game : null, sock.status === 'open', (a, b) => {
    const sound = pictionarySound(a, b);
    if (sound) play(sound);
  });
  // Notices are live only (never replayed): « presque ! » for this player's own guess.
  const { onNotice } = sock;
  useEffect(() => onNotice((n) => { if (n === 'close') play('close'); }), [onNotice]);

  if (error) return <RoomError error={error} onChangeName={onChangeName} />;

  if (!state || !sock.playerId) {
    return (
      <main className="narrow">
        <p className="status">{sock.status === 'closed' ? 'Connexion perdue, nouvelle tentative…' : 'Connexion à la salle…'}</p>
      </main>
    );
  }

  // A quiz room opened through a Pictionary link (RoomPage normally catches it before joining).
  if (state.kind !== 'pictionary') return <WrongGame code={code} expected="pictionary" actual={state.kind} />;
  const game = state.game;
  if (game.imp && isImposterPhase(game.phase)) {
    return (
      <main className="room wide play">
        {sock.status !== 'open' && <p className="banner" role="status">Connexion perdue, nouvelle tentative…</p>}
        <ImposterGame state={state} game={game} imp={game.imp} playerId={sock.playerId} names={names} offset={offset} sock={sock} />
      </main>
    );
  }
  const drawerName = game.drawerId ? names[game.drawerId] ?? null : null;
  const playing = game.phase === 'choosing' || game.phase === 'drawing' || game.phase === 'turnEnd';
  const canDraw = game.isDrawer && game.phase === 'drawing';
  const title =
    game.phase === 'choosing'
      ? game.isDrawer ? 'Choisis un mot' : `${drawerName ?? 'Le dessinateur'} choisit un mot…`
      : game.phase === 'turnEnd'
        ? 'Fin du tour'
        : game.isDrawer ? 'À toi de dessiner !' : 'Devine le dessin !';
  return (
    <main className={`room${game.phase === 'lobby' ? '' : ' wide'}${playing ? ' play' : ''}`}>
      {sock.status !== 'open' && <p className="banner" role="status">Connexion perdue, nouvelle tentative…</p>}
      {game.phase === 'lobby' && <Lobby code={code} state={state} playerId={sock.playerId} send={sock.send} />}
      {game.phase === 'gameOver' && <GameOver state={state} playerId={sock.playerId} send={sock.send} />}
      {playing && (
        <div className={`game-grid${canDraw ? ' drawer-view' : ''}`}>
          <Scoreboard state={state} playerId={sock.playerId} />
          <DrawingCanvas
            key={`${game.round}:${game.drawerId}`}
            history={game.history}
            canDraw={canDraw}
            onOp={(op) => sock.send({ t: 'draw', op })}
            subscribe={sock.onDraw}
            connected={sock.status === 'open'}
            tools={tools}
            onTools={setTools}
            header={
              <header className="nb-head">
                <div className="nb-side">
                  <span className="round" aria-label={`Manche ${game.round}/${game.settings.rounds}`}>
                    <small aria-hidden="true">Manche</small>
                    <span aria-hidden="true">{game.round}/{game.settings.rounds}</span>
                  </span>
                  <SoundControl />
                </div>
                <div className="nb-center">
                  <h1 className="nb-title">{title}</h1>
                  <WordBar game={game} drawerName={drawerName} offset={offset} send={sock.send} />
                </div>
                <div className="nb-timer">
                  <Timer endsAt={game.phaseEndsAt} offset={offset} ticking={game.phase === 'drawing'} fastEnd />
                </div>
              </header>
            }
          >
            {game.phase === 'choosing' && <WordChoice game={game} drawerName={drawerName} send={sock.send} />}
            {game.phase === 'turnEnd' && <TurnEnd game={game} names={names} />}
          </DrawingCanvas>
          <Chat game={game} names={names} send={sock.send} onNotice={sock.onNotice} />
        </div>
      )}
    </main>
  );
}

type ImpProps = {
  state: PictionaryStateMsg;
  game: PictionaryView;
  imp: ImposterView;
  playerId: string;
  names: Record<string, string>;
  offset: number;
  sock: RoomSocket;
};

/** Imposter mode, during a manche: turn order on the left, the notebook, no chat (players talk on voice). */
function ImposterGame({ state, game, imp, playerId, names, offset, sock }: ImpProps) {
  const { send } = sock;
  const canDraw = game.phase === 'impDrawing' && imp.currentDrawer === playerId;
  const drawerName = imp.currentDrawer ? names[imp.currentDrawer] ?? 'Quelqu\'un' : null;
  const accusedName = imp.accused ? names[imp.accused] ?? '?' : '?';
  const title =
    game.phase === 'impReveal' ? 'Découvre ton rôle'
      : game.phase === 'impDrawing' ? (canDraw ? 'À toi de dessiner !' : `${drawerName} dessine…`)
        : game.phase === 'impDiscuss' ? 'Discussion'
          : game.phase === 'impVote' ? 'Qui est l\'imposteur ?'
            : game.phase === 'impGuess' ? (imp.isImposter ? 'Dernière chance !' : `${accusedName} tente sa chance…`)
              : 'Résultat';
  const ticking = game.phase === 'impVote' || (game.phase === 'impDrawing' && canDraw) || (game.phase === 'impGuess' && imp.isImposter);
  const color = imp.colors[playerId];
  return (
    <div className={`game-grid imp-view${canDraw ? ' drawer-view' : ''}`}>
      <div className="imp-side">
        <TurnBar game={game} imp={imp} players={state.players} hostId={state.hostId} playerId={playerId} offset={offset} />
        {game.phase === 'impDiscuss' && <Discussion isHost={state.hostId === playerId} send={send} />}
        {game.phase === 'impVote' && <Vote imp={imp} players={state.players} playerId={playerId} send={send} />}
        {game.phase === 'impGuess' && <Guess imp={imp} names={names} send={send} />}
      </div>
      <DrawingCanvas
        key={`${imp.manche}:${imp.tableRound}:${imp.currentDrawer}`}
        history={game.history}
        canDraw={canDraw}
        onOp={(op) => send({ t: 'draw', op })}
        subscribe={sock.onDraw}
        connected={sock.status === 'open'}
        tools={DEFAULT_TOOL_STATE}
        onTools={() => {}}
        single={canDraw && color ? { color, size: IMP_STROKE_SIZE, onDone: () => send({ t: 'impDone' }) } : undefined}
        header={
          <header className="nb-head">
            <div className="nb-side">
              <span className="round" aria-label={`Manche ${imp.manche}/${imp.manches}`}>
                <small aria-hidden="true">Manche</small>
                <span aria-hidden="true">{imp.manche}/{imp.manches}</span>
              </span>
              <SoundControl />
            </div>
            <div className="nb-center">
              <h1 className="nb-title">{title}</h1>
              <SecretLine imp={imp} />
            </div>
            <div className="nb-timer">
              <Timer endsAt={game.phaseEndsAt} offset={offset} ticking={ticking} fastEnd={game.phase === 'impDrawing'} />
            </div>
          </header>
        }
      >
        {game.phase === 'impReveal' && <RoleCard imp={imp} />}
        {game.phase === 'impResult' && <ImpResult game={game} imp={imp} names={names} />}
      </DrawingCanvas>
    </div>
  );
}
