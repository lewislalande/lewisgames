import { expect, test } from 'vitest';
import { floodFill } from '../src/pictionary/renderer';

function makeImg(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  return { width: w, height: h, data };
}
function px(img: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
  const i = (y * img.width + x) * 4;
  return [...img.data.slice(i, i + 4)];
}
function setPx(img: { width: number; data: Uint8ClampedArray }, x: number, y: number, c: number[]) {
  img.data.set(c, (y * img.width + x) * 4);
}

test('fills one side of a barrier only', () => {
  const img = makeImg(10, 10);
  for (let y = 0; y < 10; y++) setPx(img, 5, y, [0, 0, 0, 255]);
  floodFill(img, 1, 1, [255, 0, 0, 255]);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const expected = x < 5 ? [255, 0, 0, 255] : x === 5 ? [0, 0, 0, 255] : [255, 255, 255, 255];
      expect(px(img, x, y)).toEqual(expected);
    }
  }
});

test('tolerance fills near-white pixels', () => {
  const img = makeImg(10, 10);
  setPx(img, 3, 3, [250, 250, 250, 255]);
  floodFill(img, 0, 0, [255, 0, 0, 255]);
  expect(px(img, 3, 3)).toEqual([255, 0, 0, 255]);
});

test('filling with the same colour terminates', () => {
  const img = makeImg(10, 10);
  floodFill(img, 0, 0, [255, 255, 255, 255]);
  expect(px(img, 9, 9)).toEqual([255, 255, 255, 255]);
});

test('out-of-bounds start is a no-op', () => {
  const img = makeImg(10, 10);
  floodFill(img, -1, 4, [255, 0, 0, 255]);
  floodFill(img, 4, 10, [255, 0, 0, 255]);
  expect(px(img, 4, 4)).toEqual([255, 255, 255, 255]);
});

test('translucent fill composites over existing pixels', () => {
  const img = makeImg(4, 4);
  floodFill(img, 0, 0, [255, 0, 0, 128]);
  const [r, g, b, a] = px(img, 2, 2);
  expect(r).toBe(255);
  expect(g).toBeGreaterThan(120);
  expect(g).toBeLessThan(130);
  expect(b).toBe(g);
  expect(a).toBe(255);
});
