export function guesserPoints(elapsedMs: number, drawMs: number, isFirst: boolean): number {
  const remaining = drawMs > 0 ? Math.max(0, 1 - elapsedMs / drawMs) : 0;
  return Math.round(20 + 80 * remaining) + (isFirst ? 10 : 0);
}

export function drawerPoints(foundCount: number, guesserCount: number): number {
  return guesserCount === 0 ? 0 : Math.round((100 * foundCount) / guesserCount);
}
