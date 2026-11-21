import type { ClientMsg } from '@kg/shared';

/** Between the last stroke and the vote: talk it over (on voice chat); the host may cut it short. */
export function Discussion({ isHost, send }: { isHost: boolean; send: (m: ClientMsg) => void }) {
  return (
    <section className="card imp-phase" aria-label="Discussion">
      <h2>Discussion</h2>
      <p>Qui n'a pas l'air de connaître le mot ?</p>
      {isHost ? (
        <button type="button" className="btn btn-primary" onClick={() => send({ t: 'impSkip' })}>Passer au vote</button>
      ) : (
        <p className="muted">Le vote commence à la fin du temps.</p>
      )}
    </section>
  );
}
