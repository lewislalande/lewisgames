/** Logical coords, 0..800 x 0..600, rounded to 1 decimal. */
export type Point = [number, number];

export type DrawAction =
  | { id: string; kind: 'stroke'; tool: 'pen' | 'eraser'; color: string; size: number; opacity: number; points: Point[] }
  | { id: string; kind: 'line' | 'rect' | 'ellipse'; color: string; size: number; opacity: number; filled: boolean; from: Point; to: Point }
  | { id: string; kind: 'fill'; color: string; opacity: number; at: Point }
  | { id: string; kind: 'clear' };

export type DrawingHistory = { actions: DrawAction[]; redo: DrawAction[] };

export const MAX_STROKE_POINTS = 2000;

export function emptyHistory(): DrawingHistory {
  return { actions: [], redo: [] };
}

export function addAction(h: DrawingHistory, a: DrawAction): DrawingHistory {
  return { actions: [...h.actions, a], redo: [] };
}

export function appendPoints(h: DrawingHistory, id: string, pts: Point[]): DrawingHistory {
  const last = h.actions[h.actions.length - 1];
  if (!last || last.kind !== 'stroke' || last.id !== id) return h;
  const updated: DrawAction = { ...last, points: [...last.points, ...pts] };
  return { actions: [...h.actions.slice(0, -1), updated], redo: h.redo };
}

export function undo(h: DrawingHistory): DrawingHistory {
  const last = h.actions[h.actions.length - 1];
  if (!last) return h;
  return { actions: h.actions.slice(0, -1), redo: [...h.redo, last] };
}

export function redo(h: DrawingHistory): DrawingHistory {
  const last = h.redo[h.redo.length - 1];
  if (!last) return h;
  return { actions: [...h.actions, last], redo: h.redo.slice(0, -1) };
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

function isPoint(p: unknown): p is Point {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === 'number' && Number.isFinite(p[0]) &&
    typeof p[1] === 'number' && Number.isFinite(p[1])
  );
}

function isColor(c: unknown): boolean {
  return typeof c === 'string' && COLOR_RE.test(c);
}

function isSize(s: unknown): boolean {
  return typeof s === 'number' && Number.isFinite(s) && s >= 1 && s <= 80;
}

function isOpacity(o: unknown): boolean {
  return typeof o === 'number' && Number.isFinite(o) && o >= 0 && o <= 1;
}

export function isValidAction(a: unknown): a is DrawAction {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 64) return false;
  switch (o.kind) {
    case 'clear':
      return true;
    case 'fill':
      return isColor(o.color) && isOpacity(o.opacity) && isPoint(o.at);
    case 'line':
    case 'rect':
    case 'ellipse':
      return (
        isColor(o.color) && isSize(o.size) && isOpacity(o.opacity) &&
        typeof o.filled === 'boolean' && isPoint(o.from) && isPoint(o.to)
      );
    case 'stroke':
      return (
        (o.tool === 'pen' || o.tool === 'eraser') &&
        isColor(o.color) && isSize(o.size) && isOpacity(o.opacity) &&
        Array.isArray(o.points) && o.points.length >= 1 && o.points.length <= MAX_STROKE_POINTS &&
        o.points.every(isPoint)
      );
    default:
      return false;
  }
}
