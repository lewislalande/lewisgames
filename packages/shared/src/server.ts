import bank from './pictionary/imposter-words-fr.json';
import { pickWordFrom, type ImposterWordBank } from './pictionary/imposter';

/**
 * Server-only entry (`@kg/shared/server`): never import it from the web app. The imposter word
 * bank must stay out of the client bundle, where the imposter could read the candidate words.
 */
export const IMPOSTER_WORDS: ImposterWordBank = bank;

export function pickImposterWord(rng: () => number, used: string[]): { category: string; word: string } {
  return pickWordFrom(IMPOSTER_WORDS, rng, used);
}
