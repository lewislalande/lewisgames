import type { DrawAction, DrawingHistory, DrawOp } from '@kg/shared';

type Img = { width: number; height: number; data: Uint8ClampedArray };

const SNAPSHOT_EVERY = 20;

/**
 * Scanline flood fill. The region is the 4-connected set of pixels whose RGBA
 * is within `tolerance` (per channel) of the start pixel. `rgba` alpha is 0..255
 * and is composited source-over onto each region pixel.
 */
export function floodFill(
  img: Img,
  x: number,
  y: number,
  rgba: [number, number, number, number],
  tolerance = 32,
): void {
  const { width, height, data } = img;
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;

  const s = (y * width + x) * 4;
  const t0 = data[s], t1 = data[s + 1], t2 = data[s + 2], t3 = data[s + 3];
  const visited = new Uint8Array(width * height);
  const matches = (px: number) => {
    const i = px * 4;
    return (
      Math.abs(data[i] - t0) <= tolerance &&
      Math.abs(data[i + 1] - t1) <= tolerance &&
      Math.abs(data[i + 2] - t2) <= tolerance &&
      Math.abs(data[i + 3] - t3) <= tolerance
    );
  };

  // Collect the region first (against the original pixels), then paint it.
  const region: number[] = [];
  const stack: number[] = [x, y];
  while (stack.length) {
    const cy = stack.pop()!;
    let cx = stack.pop()!;
    let row = cy * width;
    if (visited[row + cx] || !matches(row + cx)) continue;
    while (cx > 0 && !visited[row + cx - 1] && matches(row + cx - 1)) cx--;
    let up = false;
    let down = false;
    for (; cx < width && !visited[row + cx] && matches(row + cx); cx++) {
      visited[row + cx] = 1;
      region.push(row + cx);
      if (cy > 0) {
        const m = !visited[row - width + cx] && matches(row - width + cx);
        if (m && !up) stack.push(cx, cy - 1);
        up = m;
      }
      if (cy < height - 1) {
        const m = !visited[row + width + cx] && matches(row + width + cx);
        if (m && !down) stack.push(cx, cy + 1);
        down = m;
      }
    }
  }

  const [r, g, b, a] = rgba;
  const sa = a / 255;
  for (const px of region) {
    const i = px * 4;
    const da = data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) continue;
    data[i] = Math.round((r * sa + data[i] * da * (1 - sa)) / oa);
    data[i + 1] = Math.round((g * sa + data[i + 1] * da * (1 - sa)) / oa);
    data[i + 2] = Math.round((b * sa + data[i + 2] * da * (1 - sa)) / oa);
    data[i + 3] = Math.round(oa * 255);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const layers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Draw opaque on a scratch layer, then composite with `opacity` so overlaps don't stack. */
function withLayer(ctx: CanvasRenderingContext2D, opacity: number, draw: (c: CanvasRenderingContext2D) => void) {
  if (opacity >= 1) {
    ctx.save();
    ctx.globalAlpha = 1;
    draw(ctx);
    ctx.restore();
    return;
  }
  const main = ctx.canvas;
  let layer = layers.get(main);
  if (!layer) {
    layer = document.createElement('canvas');
    layers.set(main, layer);
  }
  if (layer.width !== main.width || layer.height !== main.height) {
    layer.width = main.width;
    layer.height = main.height;
  }
  const lctx = layer.getContext('2d')!;
  lctx.clearRect(0, 0, layer.width, layer.height);
  lctx.save();
  draw(lctx);
  lctx.restore();
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function styleStroke(c: CanvasRenderingContext2D, color: string, size: number) {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = size;
  c.lineCap = 'round';
  c.lineJoin = 'round';
}

export function renderAction(ctx: CanvasRenderingContext2D, a: DrawAction): void {
  const { width, height } = ctx.canvas;
  switch (a.kind) {
    case 'clear':
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      return;
    case 'fill': {
      const img = ctx.getImageData(0, 0, width, height);
      const [r, g, b] = hexToRgb(a.color);
      floodFill(img, a.at[0], a.at[1], [r, g, b, Math.round(a.opacity * 255)]);
      ctx.putImageData(img, 0, 0);
      return;
    }
    case 'stroke': {
      const color = a.tool === 'eraser' ? '#ffffff' : a.color;
      withLayer(ctx, a.opacity, (c) => {
        styleStroke(c, color, a.size);
        if (a.points.length === 1) {
          c.beginPath();
          c.arc(a.points[0][0], a.points[0][1], a.size / 2, 0, Math.PI * 2);
          c.fill();
          return;
        }
        c.beginPath();
        c.moveTo(a.points[0][0], a.points[0][1]);
        for (let i = 1; i < a.points.length; i++) c.lineTo(a.points[i][0], a.points[i][1]);
        c.stroke();
      });
      return;
    }
    case 'line':
    case 'rect':
    case 'ellipse': {
      const [x1, y1] = a.from;
      const [x2, y2] = a.to;
      withLayer(ctx, a.opacity, (c) => {
        styleStroke(c, a.color, a.size);
        c.beginPath();
        if (a.kind === 'line') {
          c.moveTo(x1, y1);
          c.lineTo(x2, y2);
          c.stroke();
          return;
        }
        if (a.kind === 'rect') {
          c.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else {
          c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
        }
        if (a.filled) c.fill();
        else c.stroke();
      });
      return;
    }
  }
}

/**
 * Draws a DrawingHistory onto a canvas (800x600 logical). `apply` receives the
 * history AFTER the op. Add/append are drawn incrementally; undo/redo rebuild
 * from the nearest snapshot (one every 20 committed actions).
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  /** snapshots[k] = canvas state after the first k actions (k multiple of 20). */
  private snapshots = new Map<number, ImageData>();
  /** Number of actions currently painted on the canvas. */
  private drawn = 0;
  /** Canvas before the last action, kept only when it is a stroke (for append redraws). */
  private base: ImageData | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  }

  reset(h: DrawingHistory): void {
    this.snapshots.clear();
    this.rebuild(h);
  }

  apply(op: DrawOp, h: DrawingHistory): void {
    const n = h.actions.length;
    const last = h.actions[n - 1];
    if (op.op === 'add' && last && this.drawn === n - 1) {
      this.drawAdded(last, n - 1);
    } else if (op.op === 'append' && last && last.kind === 'stroke' && last.id === op.id && this.drawn === n && this.base) {
      this.ctx.putImageData(this.base, 0, 0);
      renderAction(this.ctx, last);
    } else {
      this.rebuild(h);
    }
  }

  private drawAdded(a: DrawAction, prevCount: number): void {
    this.dropSnapshotsAbove(prevCount);
    this.maybeSnapshot(prevCount);
    this.base = a.kind === 'stroke' ? this.read() : null;
    renderAction(this.ctx, a);
    this.drawn = prevCount + 1;
  }

  private rebuild(h: DrawingHistory): void {
    const n = h.actions.length;
    this.dropSnapshotsAbove(n);
    let start = 0;
    for (const k of this.snapshots.keys()) if (k > start) start = k;
    const snap = this.snapshots.get(start);
    if (snap) this.ctx.putImageData(snap, 0, 0);
    else this.paintWhite();
    this.base = null;
    for (let i = start; i < n; i++) {
      this.maybeSnapshot(i);
      const a = h.actions[i];
      if (i === n - 1 && a.kind === 'stroke') this.base = this.read();
      renderAction(this.ctx, a);
    }
    this.drawn = n;
  }

  private maybeSnapshot(count: number): void {
    if (count > 0 && count % SNAPSHOT_EVERY === 0 && !this.snapshots.has(count)) {
      this.snapshots.set(count, this.read());
    }
  }

  private dropSnapshotsAbove(count: number): void {
    for (const k of [...this.snapshots.keys()]) if (k > count) this.snapshots.delete(k);
  }

  private read(): ImageData {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  private paintWhite(): void {
    this.ctx.save();
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }
}
