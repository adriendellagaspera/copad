// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { readString, writeString, removeKey, readJSON, writeJSON } from './localStore.js';

beforeEach(() => localStorage.clear());

describe('localStore strings', () => {
  it('round-trips a string and returns null when absent', () => {
    expect(readString('k')).toBe(null);
    writeString('k', 'v');
    expect(readString('k')).toBe('v');
    removeKey('k');
    expect(readString('k')).toBe(null);
  });
});

describe('localStore JSON', () => {
  it('round-trips a value', () => {
    writeJSON('j', { a: 1, b: ['x'] });
    expect(readJSON('j', null)).toEqual({ a: 1, b: ['x'] });
  });

  it('returns the fallback when absent', () => {
    expect(readJSON('missing', { d: true })).toEqual({ d: true });
  });

  it('returns the fallback on malformed JSON', () => {
    writeString('bad', '{not json');
    expect(readJSON('bad', [])).toEqual([]);
  });
});
