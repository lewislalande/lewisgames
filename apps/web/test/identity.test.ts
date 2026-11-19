import { beforeEach, expect, test } from 'vitest';
import { getName, getToken, setName } from '../src/lib/identity';

beforeEach(() => localStorage.clear());

test('getToken creates once and persists', () => {
  const a = getToken();
  expect(a.length).toBeGreaterThan(10);
  expect(getToken()).toBe(a);
  expect(localStorage.getItem('kg.token')).toBe(a);
});

test('setName trims and getName reads it back', () => {
  expect(getName()).toBeNull();
  setName(' Bob ');
  expect(getName()).toBe('Bob');
});
