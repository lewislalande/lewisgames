export function guesserPoints(elapsedMs: number, drawMs: number, isFirst: boolean): number {
  const elapsed = Math.max(0, elapsedMs);
  const remaining = drawMs > 0 ? Math.min(1, Math.max(0, 1 - elapsed / drawMs)) : 0;
  return Math.round(20 + 80 * remaining) + (isFirst ? 10 : 0);
}

export function drawerPoints(foundCount: number, guesserCount: number): number {
  if (guesserCount <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((100 * foundCount) / guesserCount)));
}
