import { expect, test } from 'vitest';
import { shortcutFor, toLogical } from '../src/pictionary/DrawingCanvas';

const rect = { left: 100, top: 50, width: 400, height: 300 };
const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

test('maps client coords to logical 800x600, rounded to 1 decimal', () => {
  expect(toLogical(100, 50, rect)).toEqual([0, 0]);
  expect(toLogical(500, 350, rect)).toEqual([800, 600]);
  expect(toLogical(300.123, 200.0371, rect)).toEqual([400.2, 300.1]);
});

test('clamps outside the canvas', () => {
  expect(toLogical(0, 1000, rect)).toEqual([0, 600]);
  expect(toLogical(900, -20, rect)).toEqual([800, 0]);
});

test('keyboard shortcuts', () => {
  expect(shortcutFor(key('z', { ctrlKey: true }))).toEqual({ kind: 'undo' });
  expect(shortcutFor(key('z', { metaKey: true }))).toEqual({ kind: 'undo' });
  expect(shortcutFor(key('Z', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'redo' });
  expect(shortcutFor(key('y', { ctrlKey: true }))).toEqual({ kind: 'redo' });
  expect(shortcutFor(key('b'))).toEqual({ kind: 'tool', tool: 'pen' });
  expect(shortcutFor(key('E'))).toEqual({ kind: 'tool', tool: 'eraser' });
  expect(shortcutFor(key('f'))).toEqual({ kind: 'tool', tool: 'fill' });
  expect(shortcutFor(key('l'))).toEqual({ kind: 'tool', tool: 'line' });
  expect(shortcutFor(key('r'))).toEqual({ kind: 'tool', tool: 'rect' });
  expect(shortcutFor(key('o'))).toEqual({ kind: 'tool', tool: 'ellipse' });
  expect(shortcutFor(key('r', { ctrlKey: true }))).toBeNull();
  expect(shortcutFor(key('x'))).toBeNull();
  expect(shortcutFor(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
});
