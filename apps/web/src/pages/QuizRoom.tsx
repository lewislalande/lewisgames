import { useEffect, useMemo, useState } from 'react';
import type { ErrorCode, QuizPhase } from '@kg/shared';
import { useRoomSocket } from '../lib/socket';
import { RoomError, WrongGame } from '../room/RoomError';
import { RoomPage } from '../room/RoomPage';
import { QuizLobby } from '../quiz/QuizLobby';
import { QuizScoreboard } from '../quiz/QuizScoreboard';
import { Timer } from '../pictionary/Timer';
import { Answering } from '../quiz/Answering';
import { Transition } from '../quiz/Transition';
import { SpeedChip } from '../quiz/cards';
import { Voting } from '../quiz/Voting';
import { QuestionResult } from '../quiz/QuestionResult';
import { QuizGameOver } from '../quiz/QuizGameOver';
import { SoundControl } from '../room/SoundControl';
import { useStateChanges } from '../room/useStateChanges';
import { quizSound } from '../room/gameSounds';
import { play } from '../lib/sound';

/** Refusals that leave the socket open, shown as a banner. */
const NOTICES: Partial<Record<ErrorCode, string>> = {
  no_questions: 'Aucune question dans ces thèmes. Ajoute-en depuis la page admin.',
  internal: 'Oups, le serveur a eu un souci. Réessaie.',
};

const title = (phase: QuizPhase, n: number, total: number): string =>
  phase === 'answering' ? 'Réponds !' : `Correction — question ${n}/${total}`;

export function QuizRoom({ code }: { code: string }) {
  return (
    <RoomPage code={code} game="quiz">
      {(name, onChangeName) => <Connected code={code} name={name} onChangeName={onChangeName} />}
    </RoomPage>
  );
}

function Connected({ code, name, onChangeName }: { code: string; name: string; onChangeName: () => void }) {
  const sock = useRoomSocket(code, name);
  const { state, error, onError } = sock;
  const [notice, setNotice] = useState<string | null>(null);
  // Server clock offset, re-measured on every state message (same as the Pictionary timer).
  const offset = useMemo(() => (state ? state.game.serverNow - Date.now() : 0), [state]);
  const names = useMemo(() => Object.fromEntries((state?.players ?? []).map((p) => [p.id, p.name])), [state]);

  useEffect(() => onError((c) => { const text = NOTICES[c]; if (text) setNotice(text); }), [onError]);
  // A notice is about the last attempt: drop it once the phase or the settings change.
  const phase = state?.kind === 'quiz' ? state.game.phase : null;
  const settingsKey = state?.kind === 'quiz' ? JSON.stringify(state.game.settings) : '';
  useEffect(() => setNotice(null), [phase, settingsKey]);
  useStateChanges(state?.kind === 'quiz' ? state.game : null, sock.status === 'open', (a, b) => {
    const sound = sock.playerId ? quizSound(a, b, sock.playerId) : null;
    if (sound) play(sound);
  });

  if (error) return <RoomError error={error} onChangeName={onChangeName} />;

  if (!state || !sock.playerId) {
    return (
      <main className="narrow">
        <p className="status">{sock.status === 'closed' ? 'Connexion perdue, nouvelle tentative…' : 'Connexion à la salle…'}</p>
      </main>
    );
  }

  // A Pictionary room opened through a quiz link (RoomPage normally catches it before joining).
  if (state.kind !== 'quiz') return <WrongGame code={code} expected="quiz" actual={state.kind} />;
  const game = state.game;
  const playerId = sock.playerId;
  const isHost = state.hostId === playerId;
  const hostName = (state.hostId && names[state.hostId]) || "L'hôte";
  const playing = game.phase !== 'lobby' && game.phase !== 'gameOver';
  return (
    <main className={`room${game.phase === 'lobby' ? '' : ' wide'}${playing ? ' play' : ''}`}>
      {sock.status !== 'open' && <p className="banner" role="status">Connexion perdue, nouvelle tentative…</p>}
      {notice && game.phase !== 'lobby' && <p className="banner banner-error" role="alert">{notice}</p>}
      {game.phase === 'lobby' && (
        <QuizLobby code={code} state={state} playerId={playerId} send={sock.send} notice={notice} onStart={() => setNotice(null)} />
      )}
      {game.phase === 'gameOver' && <QuizGameOver state={state} playerId={playerId} send={sock.send} />}
      {playing && (
        <div className="quiz-grid">
          <QuizScoreboard state={state} playerId={playerId} />
          <section
            className={`notebook qz-notebook qz-${game.phase}`}
            aria-label={`Question ${game.phase === 'transition' ? game.questionNumber + 1 : game.questionNumber}/${game.questionCount}`}
          >
            <span className="ring ring-l" aria-hidden="true" />
            <span className="ring ring-r" aria-hidden="true" />
            {game.phase !== 'transition' && (
            <header className="nb-head">
              <div className="nb-side">
                <span className="round" aria-hidden="true">
                  <small>Question</small>
                  <span>{game.questionNumber}/{game.questionCount}</span>
                </span>
                <SoundControl />
              </div>
              <div className="nb-center">
                {game.question && <span className="nb-theme">{game.question.theme}</span>}
                <h1 className="nb-title">{title(game.phase, game.questionNumber, game.questionCount)}</h1>
              </div>
              <div className="nb-timer">
                {game.phase === 'answering' && (
                  <>
                    <SpeedChip rate={game.timeRate} />
                    <Timer endsAt={game.phaseEndsAt} offset={offset} rate={game.timeRate} ticking />
                  </>
                )}
              </div>
            </header>
            )}
            {game.phase === 'transition' && <Transition game={game} />}
            {game.phase === 'answering' && (
              <Answering key={game.questionNumber} game={game} connectedIds={state.players.filter((p) => p.connected).map((p) => p.id)} send={sock.send} online={sock.status === 'open'} />
            )}
            {(game.phase === 'voting' || game.phase === 'deciding') && (
              <Voting game={game} names={names} playerId={playerId} isHost={isHost} hostName={hostName} send={sock.send} />
            )}
            {game.phase === 'result' && (
              <QuestionResult game={game} players={state.players} names={names} playerId={playerId} hostId={state.hostId} hostName={hostName} send={sock.send} />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
