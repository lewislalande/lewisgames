import type { ImposterView } from '@kg/shared';

/** The role reveal over the canvas at the start of a manche. `data-imposter` is read by the e2e test. */
export function RoleCard({ imp }: { imp: ImposterView }) {
  const spectator = !imp.isImposter && imp.word === null;
  return (
    <div className="overlay">
      <div className={`overlay-card role-card${imp.isImposter ? ' is-imposter' : ''}`} role="dialog" aria-label="Ton rôle" data-imposter={imp.isImposter}>
        <p className="role-cat">Catégorie : <strong>{imp.category}</strong></p>
        {imp.isImposter ? (
          <p className="role-imposter">Tu es l'imposteur 🤫</p>
        ) : spectator ? (
          <p className="role-word">Tu joueras à la prochaine manche.</p>
        ) : (
          <p className="role-word">Le mot : <strong>{imp.word}</strong></p>
        )}
      </div>
    </div>
  );
}

/** Notebook header line: the category, and the word (« ??? » for whoever does not know it). */
export function SecretLine({ imp }: { imp: ImposterView }) {
  return (
    <div className="secret-line">
      <span className="nb-theme">{imp.category}</span>
      <span className={`secret-word${imp.word === null ? ' unknown' : ''}`}>{imp.word ?? '???'}</span>
    </div>
  );
}
