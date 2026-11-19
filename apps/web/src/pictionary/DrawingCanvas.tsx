import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { addAction, appendPoints, MAX_STROKE_POINTS, redo, undo } from '@kg/shared';
import type { DrawAction, DrawingHistory, DrawOp, Point } from '@kg/shared';
import { Renderer, renderAction } from './renderer';
import { DEFAULT_TOOL_STATE, TOOLS, Toolbar } from './Toolbar';
import type { Tool, ToolState } from './Toolbar';

export const WIDTH = 800;
export const HEIGHT = 600;
const FLUSH_MS = 40;
/** Server limit for one `append` message. */
const MAX_APPEND_POINTS = 200;

type Rect = { left: number; top: number; width: number; height: number };

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));

/** Pointer position (client px) → logical 800×600 coords, clamped and rounded to 1 decimal. */
export function toLogical(clientX: number, clientY: number, r: Rect): Point {
  const x = r.width > 0 ? ((clientX - r.left) / r.width) * WIDTH : 0;
  const y = r.height > 0 ? ((clientY - r.top) / r.height) * HEIGHT : 0;
  return [round1(clamp(x, WIDTH)), round1(clamp(y, HEIGHT))];
}

export type Shortcut = { kind: 'undo' } | { kind: 'redo' } | { kind: 'tool'; tool: Tool };

/** Maps a keydown to a drawing shortcut, or null. */
export function shortcutFor(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Shortcut | null {
  if (e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (k === 'y') return { kind: 'redo' };
    return null;
  }
  if (e.shiftKey) return null;
  const t = TOOLS.find((t) => t.key.toLowerCase() === k);
  return t ? { kind: 'tool', tool: t.tool } : null;
}

const NON_TYPING_INPUTS = new Set(['range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset']);
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NON_TYPING_INPUTS.has(target.type);
}

const newId = () => crypto.randomUUID().slice(0, 12);

function applyOp(h: DrawingHistory, op: DrawOp): DrawingHistory {
  switch (op.op) {
    case 'add': return addAction(h, op.action);
    case 'append': return appendPoints(h, op.id, op.points);
    case 'undo': return undo(h);
    case 'redo': return redo(h);
  }
}

const lastId = (h: DrawingHistory) => h.actions[h.actions.length - 1]?.id;

type Gesture =
  | { kind: 'stroke'; pointerId: number; id: string; count: number; last: Point; pending: Point[] }
  | { kind: 'shape'; pointerId: number; from: Point; to: Point };

type Props = {
  history: DrawingHistory;
  canDraw: boolean;
  onOp: (op: DrawOp) => void;
  subscribe: (cb: (op: DrawOp) => void) => () => void;
};

/**
 * Canvas shared by everyone. The drawer applies ops locally at once and sends
 * them; others render relayed ops and resync from `history` when it diverges.
 * Mount one instance per turn (React `key`): the drawer's copy is authoritative
 * for the whole turn.
 */
export function DrawingCanvas({ history, canDraw, onOp, subscribe }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const local = useRef<DrawingHistory>(history);
  const gesture = useRef<Gesture | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [tools, setTools] = useState<ToolState>(DEFAULT_TOOL_STATE);
  const onOpRef = useRef(onOp);
  onOpRef.current = onOp;

  useLayoutEffect(() => {
    renderer.current = new Renderer(canvasRef.current!);
    renderer.current.reset(local.current);
  }, []);

  /** Apply locally, repaint, and (drawer) send. */
  const commit = useCallback((op: DrawOp, send: boolean) => {
    const next = applyOp(local.current, op);
    if (next === local.current) return;
    local.current = next;
    renderer.current?.apply(op, next);
    if (send) onOpRef.current(op);
  }, []);

  // Non-drawers: resync whenever the server's history diverges from ours. Layout
  // effect so it runs before the next relayed op is processed.
  useLayoutEffect(() => {
    if (canDraw) return;
    const h = local.current;
    if (history.actions.length !== h.actions.length || lastId(history) !== lastId(h)) {
      local.current = history;
      renderer.current?.reset(history);
    }
  }, [history, canDraw]);

  useEffect(() => {
    if (canDraw) return;
    return subscribe((op) => commit(op, false));
  }, [canDraw, subscribe, commit]);

  // --- drawer input ---------------------------------------------------------

  const flush = useCallback(() => {
    const g = gesture.current;
    if (!g || g.kind !== 'stroke' || g.pending.length === 0) return;
    const points = g.pending;
    g.pending = [];
    onOpRef.current({ op: 'append', id: g.id, points });
  }, []);

  const stopTimer = () => {
    clearInterval(flushTimer.current);
    flushTimer.current = undefined;
  };

  const clearOverlay = () => {
    const o = overlayRef.current;
    o?.getContext('2d')?.clearRect(0, 0, o.width, o.height);
  };

  const shapeAction = (g: Extract<Gesture, { kind: 'shape' }>): DrawAction => ({
    id: newId(),
    kind: tools.tool as 'line' | 'rect' | 'ellipse',
    color: tools.color,
    size: tools.size,
    opacity: tools.opacity,
    filled: tools.tool !== 'line' && tools.filled,
    from: g.from,
    to: g.to,
  });

  const startStroke = (pointerId: number, at: Point) => {
    const id = newId();
    gesture.current = { kind: 'stroke', pointerId, id, count: 1, last: at, pending: [] };
    commit({
      op: 'add',
      action: { id, kind: 'stroke', tool: tools.tool as 'pen' | 'eraser', color: tools.color, size: tools.size, opacity: tools.opacity, points: [at] },
    }, true);
  };

  const pos = (e: ReactPointerEvent) => toLogical(e.clientX, e.clientY, canvasRef.current!.getBoundingClientRect());

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || gesture.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const at = pos(e);
    switch (tools.tool) {
      case 'fill':
        commit({ op: 'add', action: { id: newId(), kind: 'fill', color: tools.color, opacity: tools.opacity, at } }, true);
        return;
      case 'pen':
      case 'eraser':
        e.currentTarget.setPointerCapture(e.pointerId);
        startStroke(e.pointerId, at);
        flushTimer.current = setInterval(flush, FLUSH_MS);
        return;
      default:
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = { kind: 'shape', pointerId: e.pointerId, from: at, to: at };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const at = pos(e);
    if (g.kind === 'shape') {
      g.to = at;
      const o = overlayRef.current!;
      const ctx = o.getContext('2d')!;
      ctx.clearRect(0, 0, o.width, o.height);
      renderAction(ctx, shapeAction(g));
      return;
    }
    if (at[0] === g.last[0] && at[1] === g.last[1]) return;
    if (g.count >= MAX_STROKE_POINTS) {
      // Stroke full: continue in a new stroke starting from the last point.
      flush();
      const prev = g.last;
      startStroke(g.pointerId, prev);
    }
    const s = gesture.current as Extract<Gesture, { kind: 'stroke' }>;
    s.count += 1;
    s.last = at;
    s.pending.push(at);
    commit({ op: 'append', id: s.id, points: [at] }, false);
    if (s.pending.length >= MAX_APPEND_POINTS) flush();
  };

  const endGesture = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.kind === 'stroke') {
      flush();
      stopTimer();
    } else {
      clearOverlay();
      const same = g.from[0] === g.to[0] && g.from[1] === g.to[1];
      if (e.type === 'pointerup' && !same) commit({ op: 'add', action: shapeAction(g) }, true);
    }
    gesture.current = null;
  };

  useEffect(() => stopTimer, []);

  // Turn over mid-gesture: drop whatever was in progress.
  useEffect(() => {
    if (canDraw) return;
    stopTimer();
    gesture.current = null;
    clearOverlay();
  }, [canDraw]);

  const doUndo = useCallback(() => commit({ op: 'undo' }, true), [commit]);
  const doRedo = useCallback(() => commit({ op: 'redo' }, true), [commit]);
  const doClear = () => commit({ op: 'add', action: { id: newId(), kind: 'clear' } }, true);

  useEffect(() => {
    if (!canDraw) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = shortcutFor(e);
      if (!s) return;
      e.preventDefault();
      if (s.kind === 'undo') doUndo();
      else if (s.kind === 'redo') doRedo();
      else setTools((t) => ({ ...t, tool: s.tool }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDraw, doUndo, doRedo]);

  return (
    <div className="drawing">
      <div className={`canvas-wrap${canDraw ? ` can-draw tool-${tools.tool}` : ''}`}>
        <canvas
          ref={canvasRef}
          className="board"
          width={WIDTH}
          height={HEIGHT}
          aria-label="Zone de dessin"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        />
        <canvas ref={overlayRef} className="board-overlay" width={WIDTH} height={HEIGHT} aria-hidden="true" />
      </div>
      {canDraw && <Toolbar value={tools} onChange={setTools} onUndo={doUndo} onRedo={doRedo} onClear={doClear} />}
    </div>
  );
}
