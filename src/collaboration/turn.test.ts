// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getTurnPrefs, setTurnPrefs, turnRelayStatus, TurnRelayStatus } from './turn.js';
import type { TurnPrefs, TurnUrlDraft } from './turn.js';
import { parseTurnUrl, parseTurnUsername, parseTurnCredential } from './parse.js';
import { FallbackTurnPolicy } from './types.js';

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

describe('turnRelayStatus', () => {
  const draft = (v: string): TurnUrlDraft => v as TurnUrlDraft;

  it('reports a custom relay whenever the field holds a URL', () => {
    expect(turnRelayStatus(draft('turn:relay.example:3478'), FallbackTurnPolicy.None)).toBe(
      TurnRelayStatus.Custom,
    );
    expect(turnRelayStatus(draft('turn:relay.example:3478'), FallbackTurnPolicy.OpenRelay)).toBe(
      TurnRelayStatus.Custom,
    );
  });

  it('treats a whitespace-only field as no custom relay', () => {
    expect(turnRelayStatus(draft('   '), FallbackTurnPolicy.None)).toBe(TurnRelayStatus.None);
  });

  it('falls back to the public relay only when the policy allows it', () => {
    expect(turnRelayStatus(draft(''), FallbackTurnPolicy.OpenRelay)).toBe(TurnRelayStatus.Public);
    expect(turnRelayStatus(draft(''), FallbackTurnPolicy.None)).toBe(TurnRelayStatus.None);
  });
});
