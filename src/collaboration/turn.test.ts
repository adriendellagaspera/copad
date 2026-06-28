// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getTurnPrefs, setTurnPrefs } from './turn.js';
import type { TurnPrefs } from './turn.js';
import { parseTurnUrl, parseTurnUsername, parseTurnCredential } from './parse.js';

beforeEach(() => localStorage.clear());

describe('TURN preferences', () => {
  it('defaults to openrelay fallback with no custom server', () => {
    expect(getTurnPrefs()).toEqual({
      urls: [],
      username: '',
      credential: '',
      fallback: 'openrelay',
    });
  });

  it('round-trips a custom TURN config', () => {
    const prefs: TurnPrefs = {
      urls: [parseTurnUrl('turns:t.example:5349')!],
      username: parseTurnUsername('u'),
      credential: parseTurnCredential('c'),
      fallback: 'none',
    };
    setTurnPrefs(prefs);
    const got = getTurnPrefs();
    expect(got.urls).toEqual(['turns:t.example:5349']);
    expect(got.username).toBe('u');
    expect(got.credential).toBe('c');
    expect(got.fallback).toBe('none');
  });

  it('fills missing fields from defaults', () => {
    localStorage.setItem(
      'copad:turn',
      JSON.stringify({ urls: ['turn:x.example:3478'], username: 'bob' }),
    );
    const got = getTurnPrefs();
    expect(got.urls).toEqual(['turn:x.example:3478']);
    expect(got.username).toBe('bob');
    expect(got.credential).toBe('');
    expect(got.fallback).toBe('openrelay');
  });

  it('drops invalid URLs from stored list', () => {
    localStorage.setItem(
      'copad:turn',
      JSON.stringify({ urls: ['turns:good.example:5349', 'not-a-url', ''] }),
    );
    const got = getTurnPrefs();
    expect(got.urls).toEqual(['turns:good.example:5349']);
  });

  it('respects fallback: none', () => {
    localStorage.setItem('copad:turn', JSON.stringify({ fallback: 'none' }));
    expect(getTurnPrefs().fallback).toBe('none');
  });
});
