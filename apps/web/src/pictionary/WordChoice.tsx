import type { ClientMsg, PictionaryView } from '@kg/shared';

type Props = { game: PictionaryView; drawerName: string | null; send: (m: ClientMsg) => void };

export function WordChoice({ game, drawerName, send }: Props) {
  return (
    <div className="overlay">
      <div className="overlay-card" role="dialog" aria-label="Choix du mot">
        {game.isDrawer && game.wordChoices ? (
          <>
            <h2>Choisis ton mot</h2>
            <div className="choices">
              {game.wordChoices.map((w, i) => (
                <button key={i} type="button" className="btn btn-primary" onClick={() => send({ t: 'choose', index: i })}>
                  {w}
                </button>
              ))}
            </div>
          </>
        ) : (
          <h2>{drawerName ?? 'Le dessinateur'} choisit un mot…</h2>
        )}
      </div>
    </div>
  );
}
