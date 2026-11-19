import type { ClientMsg, QuizView, VoteValue } from '@kg/shared';
import { AnswerCard, CorrectCard, QuizFoot, VOTES, VoteButtons } from './cards';

type Props = {
  game: QuizView;
  names: Record<string, string>;
  playerId: string;
  isHost: boolean;
  hostName: string;
  send: (m: ClientMsg) => void;
};

/** Votes on each answer group (voting), then the host's tie-breaks (deciding). */
export function Voting({ game, names, playerId, isHost, hostName, send }: Props) {
  const deciding = game.phase === 'deciding';
  const groups = deciding ? game.revealed.filter((g) => game.ties.includes(g.groupId)) : game.revealed;
  const pending = game.pendingVoters.map((id) => names[id] ?? '?');

  return (
    <>
      <div className="qz-page">
        {game.correct && <div className="qz-pinned"><CorrectCard correct={game.correct} /></div>}
        {deciding && (
          <p className="qz-banner">{isHost ? 'Égalité — à toi de trancher' : `${hostName} tranche les égalités…`}</p>
        )}
        <ul className="qz-answers">
          {groups.map((g, i) => {
            const selfVote = game.selfVoteGroups.includes(g.groupId);
            const mine = g.authors.includes(playerId) && !selfVote;
            return (
              <AnswerCard key={g.groupId} text={g.text} authors={g.authors} names={names} index={i} className={mine && !deciding ? 'mine' : ''}>
                {deciding ? (
                  <div className="qz-decide">
                    {game.voteCounts?.[g.groupId] && <TieCounts counts={game.voteCounts[g.groupId]!} />}
                    {isHost && <VoteButtons value={undefined} onVote={(vote) => send({ t: 'decide', groupId: g.groupId, vote })} />}
                  </div>
                ) : mine ? (
                  <span className="qz-mine">Ta réponse</span>
                ) : (
                  <div className="qz-vote-col">
                    {selfVote && <span className="qz-hint">Tout le monde a répondu pareil : votez quand même</span>}
                    <VoteButtons value={game.myVotes[g.groupId]} onVote={(vote) => send({ t: 'vote', groupId: g.groupId, vote })} />
                  </div>
                )}
              </AnswerCard>
            );
          })}
        </ul>
      </div>
      <QuizFoot
        action={!deciding && isHost && <button className="btn btn-primary" onClick={() => send({ t: 'closeVote' })}>Terminer le vote</button>}
      >
        {deciding
          ? isHost && 'Choisis ✅, ½ ou ❌ pour chaque réponse à égalité.'
          : pending.length > 0 ? `En attente de : ${pending.join(', ')}` : 'Tout le monde a voté.'}
      </QuizFoot>
    </>
  );
}

function TieCounts({ counts }: { counts: Record<VoteValue, number> }) {
  return (
    <span className="qz-tie-counts">
      {VOTES.map((v) => `${counts[v.value]} ${v.icon}`).join(' · ')}
    </span>
  );
}
