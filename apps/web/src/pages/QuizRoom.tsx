import { useEffect, useState } from 'react';
import type { ErrorCode } from '@kg/shared';
import { useRoomSocket } from '../lib/socket';
import { RoomError, WrongGame } from '../room/RoomError';
import { RoomPage } from '../room/RoomPage';
import { QuizLobby } from '../quiz/QuizLobby';
import { QuizScoreboard } from '../quiz/QuizScoreboard';

/** Refusals that leave the socket open, shown as a banner. */
const NOTICES: Partial<Record<ErrorCode, string>> = {
  no_questions: 'Aucune question dans ces thèmes. Ajoute-en depuis la page admin.',
  internal: 'Oups, le serveur a eu un souci. Réessaie.',
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
  return (
    <main className={`room${game.phase === 'lobby' ? '' : ' wide'}`}>
      {sock.status !== 'open' && <p className="banner" role="status">Connexion perdue, nouvelle tentative…</p>}
      {game.phase === 'lobby' ? (
        <QuizLobby code={code} state={state} playerId={sock.playerId} send={sock.send} notice={notice} onStart={() => setNotice(null)} />
      ) : (
        <>
          {notice && <p className="banner banner-error" role="alert">{notice}</p>}
          <div className="quiz-placeholder">
            <QuizScoreboard state={state} playerId={sock.playerId} />
            <section className="card">
              <h1 className="title-sm">Partie en cours…</h1>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
