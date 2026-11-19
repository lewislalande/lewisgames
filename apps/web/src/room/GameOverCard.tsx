import type { PlayerInfo } from '@kg/shared';
import { Podium } from './Podium';

type Props = {
  players: PlayerInfo[];
  scores: Record<string, number>;
  hostId: string | null;
  playerId: string;
  onRestart: () => void;
  format?: (score: number) => string;
};

/** « Partie terminée ! »: podium, ranking, « Rejouer » (host) / « Accueil ». */
export function GameOverCard({ players, scores, hostId, playerId, onRestart, format }: Props) {
  const rows = players
    .map((p) => ({ ...p, score: scores[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  return (
    <section className="card gameover">
      <h1 className="title-sm">Partie terminée !</h1>
      <Podium rows={rows} playerId={playerId} format={format} />
      <div className="gameover-actions">
        {hostId === playerId ? (
          <button className="btn btn-primary btn-big" onClick={onRestart}>Rejouer</button>
        ) : (
          <p className="muted">En attente de l'hôte…</p>
        )}
        <a className="btn" href="/">Accueil</a>
      </div>
    </section>
  );
}
