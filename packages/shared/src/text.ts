export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[-'’_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function classifyGuess(
  guess: string,
  word: string,
  closeDetection: boolean,
): 'correct' | 'close' | 'wrong' {
  const g = normalize(guess);
  const w = normalize(word);
  if (g === '') return 'wrong';
  const d = levenshtein(g, w);
  if (d === 0) return 'correct';
  if (!closeDetection) return 'wrong';
  const threshold = w.length < 8 ? 1 : 2;
  return d <= threshold ? 'close' : 'wrong';
}
