import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { addAction, appendPoints, isValidAction, MAX_STROKE_POINTS, redo, undo } from '@kg/shared';
import type { DrawAction, DrawingHistory, DrawOp, Point } from '@kg/shared';
import { Renderer, renderAction } from './renderer';
import { TOOLS, Toolbar } from './Toolbar';
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

type ShapeAction = Extract<DrawAction, { kind: 'line' | 'rect' | 'ellipse' }>;
type Gesture =
  | { kind: 'stroke'; pointerId: number; id: string; count: number; last: Point; pending: Point[] }
  /** The shape's kind and style are fixed at pointerdown; only `to` follows the pointer. */
  | { kind: 'shape'; pointerId: number; action: ShapeAction };

type Props = {
  history: DrawingHistory;
  canDraw: boolean;
  onOp: (op: DrawOp) => void;
  subscribe: (cb: (op: DrawOp) => void) => () => void;
  /** Socket open. After a reconnect the next `history` replaces the local copy, drawer included. */
  connected: boolean;
  /** Owned by the parent so the drawer's tool settings survive the per-turn remount. */
  tools: ToolState;
  onTools: (t: ToolState) => void;
};

/**
 * Canvas shared by everyone. The drawer applies ops locally at once and sends
 * them; others render relayed ops and resync from `history` when it diverges.
 * Mount one instance per turn (React `key`): the drawer's copy is authoritative
 * for the whole turn.
 */
export function DrawingCanvas({ history, canDraw, onOp, subscribe, connected, tools, onTools }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const local = useRef<DrawingHistory>(history);
  const gesture = useRef<Gesture | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const onOpRef = useRef(onOp);
  onOpRef.current = onOp;

  useLayoutEffect(() => {
    renderer.current = new Renderer(canvasRef.current!);
    renderer.current.reset(local.current);
  }, []);

  /** Apply locally, repaint, and (drawer) send. Invalid actions are dropped. */
  const commit = useCallback((op: DrawOp, send: boolean) => {
    if (op.op === 'add' && !isValidAction(op.action)) return;
    const next = applyOp(local.current, op);
    if (next === local.current) return;
    local.current = next;
    renderer.current?.apply(op, next);
    if (send) onOpRef.current(op);
  }, []);

  // After a reconnect, the history held at that moment is stale: wait for the next one.
  const staleHistory = useRef<DrawingHistory | null>(null);
  const wasConnected = useRef(connected);

  // Non-drawers: resync whenever the server's history diverges from ours. Drawer:
  // only after a reconnect (ops sent while offline were lost). Layout effect so it
  // runs before the next relayed op is processed.
  useLayoutEffect(() => {
    if (connected && !wasConnected.current) staleHistory.current = history;
    wasConnected.current = connected;
    const h = local.current;
    let reset = !canDraw && (history.actions.length !== h.actions.length || lastId(history) !== lastId(h));
    if (staleHistory.current && connected && history !== staleHistory.current) {
      staleHistory.current = null;
      reset = true;
    }
    if (reset) {
      endGesture();
      local.current = history;
      renderer.current?.reset(history);
    }
  }, [history, canDraw, connected]);

  useEffect(() => {
    if (canDraw) return;
    return subscribe((op) => commit(op, false));
  }, [canDraw, subscribe, commit]);

  // --- drawer input ---------------------------------------------------------

  function flush() {
    const g = gesture.current;
    if (!g || g.kind !== 'stroke' || g.pending.length === 0) return;
    const points = g.pending;
    g.pending = [];
    onOpRef.current({ op: 'append', id: g.id, points });
  }

  function stopTimer() {
    clearInterval(flushTimer.current);
    flushTimer.current = undefined;
  }

  function clearOverlay() {
    const o = overlayRef.current;
    o?.getContext('2d')?.clearRect(0, 0, o.width, o.height);
  }

  /** Close any open gesture: a stroke sends its pending points, a shape is dropped. */
  function endGesture() {
    flush();
    stopTimer();
    clearOverlay();
    gesture.current = null;
  }

  type StrokeStyle = Pick<Extract<DrawAction, { kind: 'stroke' }>, 'tool' | 'color' | 'size' | 'opacity'>;
  const startStroke = (pointerId: number, at: Point, style: StrokeStyle) => {
    const id = newId();
    gesture.current = { kind: 'stroke', pointerId, id, count: 1, last: at, pending: [] };
    commit({ op: 'add', action: { id, kind: 'stroke', ...style, points: [at] } }, true);
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
        startStroke(e.pointerId, at, { tool: tools.tool, color: tools.color, size: tools.size, opacity: tools.opacity });
        flushTimer.current = setInterval(flush, FLUSH_MS);
        return;
      default:
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = {
          kind: 'shape',
          pointerId: e.pointerId,
          action: {
            id: newId(), kind: tools.tool, color: tools.color, size: tools.size, opacity: tools.opacity,
            filled: tools.tool !== 'line' && tools.filled, from: at, to: at,
          },
        };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const at = pos(e);
    if (g.kind === 'shape') {
      g.action = { ...g.action, to: at };
      const o = overlayRef.current!;
      const ctx = o.getContext('2d')!;
      ctx.clearRect(0, 0, o.width, o.height);
      renderAction(ctx, g.action);
      return;
    }
    if (at[0] === g.last[0] && at[1] === g.last[1]) return;
    if (g.count >= MAX_STROKE_POINTS) {
      // Stroke full: continue in a new stroke, same style, starting from the last point.
      const full = local.current.actions[local.current.actions.length - 1];
      if (!full || full.kind !== 'stroke' || full.id !== g.id) return;
      flush();
      startStroke(g.pointerId, g.last, { tool: full.tool, color: full.color, size: full.size, opacity: full.opacity });
    }
    const s = gesture.current as Extract<Gesture, { kind: 'stroke' }>;
    s.count += 1;
    s.last = at;
    s.pending.push(at);
    commit({ op: 'append', id: s.id, points: [at] }, false);
    if (s.pending.length >= MAX_APPEND_POINTS) flush();
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.kind === 'shape') {
      const { from, to } = g.action;
      const same = from[0] === to[0] && from[1] === to[1];
      if (e.type === 'pointerup' && !same) commit({ op: 'add', action: g.action }, true);
    }
    endGesture();
  };

  useEffect(() => stopTimer, []);

  // Turn over mid-gesture: drop whatever was in progress (nothing can be sent any more).
  useEffect(() => {
    if (canDraw) return;
    stopTimer();
    gesture.current = null;
    clearOverlay();
  }, [canDraw]);

  // History commands first close the open gesture so its unsent points are flushed.
  const doUndo = () => { endGesture(); commit({ op: 'undo' }, true); };
  const doRedo = () => { endGesture(); commit({ op: 'redo' }, true); };
  const doClear = () => { endGesture(); commit({ op: 'add', action: { id: newId(), kind: 'clear' } }, true); };
  const keyActions = useRef({ doUndo, doRedo });
  keyActions.current = { doUndo, doRedo };

  useEffect(() => {
    if (!canDraw) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = shortcutFor(e);
      if (!s) return;
      e.preventDefault();
      if (s.kind === 'undo') keyActions.current.doUndo();
      else if (s.kind === 'redo') keyActions.current.doRedo();
      else if (!gesture.current) onTools({ ...toolsRef.current, tool: s.tool });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDraw]);

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
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
        />
        <canvas ref={overlayRef} className="board-overlay" width={WIDTH} height={HEIGHT} aria-hidden="true" />
      </div>
      {canDraw && <Toolbar value={tools} onChange={onTools} onUndo={doUndo} onRedo={doRedo} onClear={doClear} />}
    </div>
  );
}
