// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getTurnPrefs, setTurnPrefs } from './turn.js';

beforeEach(() => localStorage.clear());

describe('TURN preferences', () => {
  it('defaults to using the public relay with no custom server', () => {
    expect(getTurnPrefs()).toEqual({ url: '', username: '', credential: '', useDefault: true });
  });

  it('round-trips a custom TURN config', () => {
    setTurnPrefs({ url: 'turns:t.example:5349', username: 'u', credential: 'c', useDefault: false });
    expect(getTurnPrefs()).toEqual({
      url: 'turns:t.example:5349',
      username: 'u',
      credential: 'c',
      useDefault: false,
    });
  });

  it('fills missing fields from defaults', () => {
    localStorage.setItem('copad:turn', JSON.stringify({ url: 'turn:x' }));
    expect(getTurnPrefs()).toEqual({ url: 'turn:x', username: '', credential: '', useDefault: true });
  });
});
