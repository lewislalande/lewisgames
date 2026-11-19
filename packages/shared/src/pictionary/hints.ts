const ALWAYS_VISIBLE = new Set([' ', '-', "'", '’']);

export function isLetterIndex(word: string, i: number): boolean {
  const ch = word[i];
  return ch !== undefined && !ALWAYS_VISIBLE.has(ch);
}

export function maskWord(word: string, revealed: number[]): string[] {
  const shown = new Set(revealed);
  return word.split('').map((ch, i) => (!isLetterIndex(word, i) || shown.has(i) ? ch : '_'));
}

export function hintsUnlocked(elapsedMs: number, drawMs: number, unlockPct: number): boolean {
  return elapsedMs >= (drawMs * unlockPct) / 100;
}
