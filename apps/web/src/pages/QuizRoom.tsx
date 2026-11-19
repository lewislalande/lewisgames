import { useEffect, useMemo, useState } from 'react';
import type { ErrorCode, QuizPhase } from '@kg/shared';
import { useRoomSocket } from '../lib/socket';
import { RoomError, WrongGame } from '../room/RoomError';
import { RoomPage } from '../room/RoomPage';
import { QuizLobby } from '../quiz/QuizLobby';
import { QuizScoreboard } from '../quiz/QuizScoreboard';
import { Timer } from '../pictionary/Timer';
import { Answering } from '../quiz/Answering';
import { Reveal } from '../quiz/Reveal';
import { Voting } from '../quiz/Voting';
import { QuestionResult } from '../quiz/QuestionResult';
import { QuizGameOver } from '../quiz/QuizGameOver';

/** Refusals that leave the socket open, shown as a banner. */
const NOTICES: Partial<Record<ErrorCode, string>> = {
  no_questions: 'Aucune question dans ces thèmes. Ajoute-en depuis la page admin.',
  internal: 'Oups, le serveur a eu un souci. Réessaie.',
};

const TITLES: Partial<Record<QuizPhase, string>> = {
  answering: 'Réponds !',
  revealing: 'Les réponses',
  voting: 'Le vote',
  deciding: 'Égalité',
  result: 'Résultats',
};

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
          <section className={`notebook qz-notebook qz-${game.phase}`} aria-label={`Question ${game.questionNumber}/${game.questionCount}`}>
            <span className="ring ring-l" aria-hidden="true" />
            <span className="ring ring-r" aria-hidden="true" />
            <header className="nb-head">
              <span className="round" aria-hidden="true">
                <small>Question</small>
                <span>{game.questionNumber}/{game.questionCount}</span>
              </span>
              <div className="nb-center">
                {game.question && <span className="nb-theme">{game.question.theme}</span>}
                <h1 className="nb-title">{TITLES[game.phase]}</h1>
              </div>
              <div className="nb-timer">
                {game.phase === 'answering' && <Timer endsAt={game.phaseEndsAt} offset={offset} />}
              </div>
            </header>
            {game.phase === 'answering' && (
              <Answering key={game.questionNumber} game={game} connectedIds={state.players.filter((p) => p.connected).map((p) => p.id)} send={sock.send} online={sock.status === 'open'} />
            )}
            {game.phase === 'revealing' && <Reveal game={game} names={names} isHost={isHost} hostName={hostName} send={sock.send} />}
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
