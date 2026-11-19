import { normalize } from '../text';

export type VoteValue = 'yes' | 'half' | 'no';

export const isVoteValue = (v: unknown): v is VoteValue => v === 'yes' || v === 'half' || v === 'no';

export type AnswerGroup = { id: string; text: string; authors: string[] };

/** Groups identical answers (same normalize()) so each is voted on once; blank answers are excluded. */
export function groupAnswers(answers: Record<string, string>, order: string[]): AnswerGroup[] {
  const groups = new Map<string, AnswerGroup>();
  for (const author of order) {
    const raw = answers[author];
    if (typeof raw !== 'string') continue;
    const id = normalize(raw);
    if (!id) continue;
    const existing = groups.get(id);
    if (existing) existing.authors.push(author);
    else groups.set(id, { id, text: raw.trim(), authors: [author] });
  }
  return [...groups.values()];
}

/** Strict plurality wins; equal top counts (or no votes) give 'tie'. */
export function resolveVotes(votes: VoteValue[]): VoteValue | 'tie' {
  const counts: Record<VoteValue, number> = { yes: 0, half: 0, no: 0 };
  for (const v of votes) counts[v]++;
  const ranked = (Object.keys(counts) as VoteValue[]).sort((a, b) => counts[b] - counts[a]);
  const [top, second] = ranked;
  if (counts[top] === 0 || counts[top] === counts[second]) return 'tie';
  return top;
}
