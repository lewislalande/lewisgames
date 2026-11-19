import type { GameKind } from '@kg/shared';
import { roomPath } from '../lib/rooms';

const ERRORS: Record<string, string> = {
  room_full: 'Cette salle est pleine.',
  not_found: "Cette salle n'existe pas.",
  bad_name: 'Ce pseudo est invalide (1 à 20 caractères).',
  bad_token: 'Ton identifiant de joueur est invalide. Recharge la page.',
  bad_message: 'Une erreur est survenue. Recharge la page.',
};

const GAME_LABEL: Record<GameKind, string> = { pictionary: 'de Pictionary', quiz: 'de quiz' };
const GAME_NAME: Record<GameKind, string> = { pictionary: 'Pictionary', quiz: 'Quiz' };

export function RoomError({ error, onChangeName }: { error: string; onChangeName?: () => void }) {
  return (
    <main className="narrow">
      <div className="card">
        <h1 className="title-sm">Oups</h1>
        <p className="error" role="alert">{ERRORS[error] ?? ERRORS.bad_message}</p>
        {error === 'bad_name' && onChangeName && (
          <button className="btn" onClick={onChangeName}>Changer de pseudo</button>
        )}
        <a className="btn btn-primary" href="/">Retour à l'accueil</a>
      </div>
    </main>
  );
}

/** A room opened through the other game's link. */
export function WrongGame({ code, expected, actual }: { code: string; expected: GameKind; actual: GameKind }) {
  return (
    <main className="narrow">
      <div className="card">
        <h1 className="title-sm">Oups</h1>
        <p className="error" role="alert">Cette salle n'est pas une salle {GAME_LABEL[expected]}.</p>
        <a className="btn btn-primary" href={roomPath(actual, code)}>Aller à la salle {GAME_NAME[actual]}</a>
        <a className="btn" href="/">Retour à l'accueil</a>
      </div>
    </main>
  );
}
