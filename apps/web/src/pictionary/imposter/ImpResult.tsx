import type { ImposterView, PictionaryView } from '@kg/shared';
import { Dot } from './TurnBar';

type Props = { game: PictionaryView; imp: ImposterView; names: Record<string, string> };

/** End of a manche, over the drawing: the imposter, the word, the votes, the guess, the points. */
export function ImpResult({ game, imp, names }: Props) {
  const r = imp.result;
  if (!r) return null;
  const name = (id: string | null) => (id ? names[id] ?? '?' : '?');
  const caught = r.accused === r.imposterId;
  const scorers = Object.entries(game.turnPoints).filter(([, n]) => n > 0);
  return (
    <div className="overlay">
      <div className={`overlay-card imp-result${r.imposterWon ? ' imposter-won' : ''}`} role="dialog" aria-label="Résultat de la manche">
        <h2>
          <Dot color={imp.colors[r.imposterId]} /> {name(r.imposterId)} était l'imposteur !
        </h2>
        <p className="imp-result-word">Le mot : <strong>{imp.word}</strong></p>
        <p className="imp-result-line">
          {r.accused === null
            ? 'Égalité : personne n\'est désigné.'
            : caught
              ? r.guess === null
                ? 'Démasqué ! Pas de proposition.'
                : r.imposterWon
                  ? `Démasqué, mais il a trouvé le mot : « ${r.guess} »`
                  : `Démasqué ! Il a proposé « ${r.guess} »`
              : `Le vote a désigné ${name(r.accused)}.`}
        </p>
        <p className="imp-outcome">{r.imposterWon ? "L'imposteur gagne !" : "L'imposteur a perdu !"}</p>
        <div className="imp-result-cols">
          <div>
            <h3>Votes</h3>
            <ul className="player-list imp-votes">
              {imp.order.map((id) => (
                <li key={id}>
                  <Dot color={imp.colors[id]} />
                  <span className="player-name">
                    {name(id)}
                    <span className="you"> → {r.votes[id] ? name(r.votes[id]!) : 'pas de vote'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Points</h3>
            <ul className="player-list">
              {scorers.map(([id, n]) => (
                <li key={id}>
                  <Dot color={imp.colors[id]} />
                  <span className="player-name">{name(id)}</span>
                  <span className="score">+{n}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
