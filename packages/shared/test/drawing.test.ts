import { describe, it, expect } from 'vitest';
import {
  emptyHistory, addAction, appendPoints, undo, redo, isValidAction,
  type DrawAction,
} from '../src/pictionary/drawing';

const stroke = (id: string): DrawAction => ({
  id, kind: 'stroke', tool: 'pen', color: '#000000', size: 4, opacity: 1, points: [[1, 1]],
});
const rect = (id: string): DrawAction => ({
  id, kind: 'rect', color: '#ff0000', size: 4, opacity: 1, filled: false, from: [0, 0], to: [10, 10],
});

describe('drawing history', () => {
  it('undo/redo restores order', () => {
    let h = addAction(addAction(emptyHistory(), stroke('a')), stroke('b'));
    h = undo(h);
    expect(h.actions.length).toBe(1);
    expect(h.redo.length).toBe(1);
    h = redo(h);
    expect(h.actions.map((a) => a.id)).toEqual(['a', 'b']);
    expect(h.redo).toEqual([]);
  });
  it('add after undo empties redo', () => {
    let h = undo(addAction(emptyHistory(), stroke('a')));
    h = addAction(h, stroke('b'));
    expect(h.redo).toEqual([]);
  });
  it('undo/redo on empty are no-ops', () => {
    const h = emptyHistory();
    expect(undo(h)).toEqual(h);
    expect(redo(h)).toEqual(h);
  });
  it('appendPoints only extends the last stroke', () => {
    const h = addAction(addAction(emptyHistory(), stroke('a')), stroke('b'));
    expect(appendPoints(h, 'a', [[2, 2]])).toEqual(h);
    const h2 = appendPoints(h, 'b', [[2, 2], [3, 3]]);
    expect((h2.actions[1] as any).points).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect((h.actions[1] as any).points).toEqual([[1, 1]]);
    const hr = addAction(emptyHistory(), rect('r'));
    expect(appendPoints(hr, 'r', [[2, 2]])).toEqual(hr);
  });
  it('clear is undoable', () => {
    let h = addAction(addAction(emptyHistory(), stroke('a')), stroke('b'));
    h = addAction(h, { id: 'c', kind: 'clear' });
    h = undo(h);
    expect(h.actions.map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('isValidAction', () => {
  it('accepts valid actions', () => {
    expect(isValidAction(stroke('a'))).toBe(true);
    expect(isValidAction(rect('r'))).toBe(true);
    expect(isValidAction({ id: 'f', kind: 'fill', color: '#AbCdEf', opacity: 0.5, at: [1, 2] })).toBe(true);
    expect(isValidAction({ id: 'c', kind: 'clear' })).toBe(true);
  });
  it('rejects bad actions', () => {
    expect(isValidAction({ kind: 'stroke', color: 'red' })).toBe(false);
    expect(isValidAction({ ...stroke('a'), size: 500 })).toBe(false);
    expect(isValidAction({ ...stroke('a'), size: 0 })).toBe(false);
    expect(isValidAction({ ...stroke('a'), opacity: 2 })).toBe(false);
    expect(isValidAction({ ...stroke('a'), color: 'red' })).toBe(false);
    expect(isValidAction({ ...stroke('a'), id: '' })).toBe(false);
    expect(isValidAction({ ...stroke('a'), id: 'x'.repeat(65) })).toBe(false);
    expect(isValidAction({ ...stroke('a'), tool: 'brush' })).toBe(false);
    expect(isValidAction({ ...stroke('a'), points: [] })).toBe(false);
    expect(isValidAction({ ...stroke('a'), points: Array(2001).fill([0, 0]) })).toBe(false);
    expect(isValidAction({ ...stroke('a'), points: [[NaN, 0]] })).toBe(false);
    expect(isValidAction({ ...stroke('a'), points: [[1]] })).toBe(false);
    expect(isValidAction({ ...rect('r'), filled: 'yes' })).toBe(false);
    expect(isValidAction({ ...rect('r'), to: [Infinity, 0] })).toBe(false);
    expect(isValidAction({ id: 'f', kind: 'fill', color: '#000000', opacity: 1, at: 'x' })).toBe(false);
    expect(isValidAction({ id: 'z', kind: 'nope' })).toBe(false);
    expect(isValidAction(null)).toBe(false);
    expect(isValidAction('x')).toBe(false);
  });
});
