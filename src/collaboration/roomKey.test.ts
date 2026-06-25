// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import type { RoomId } from './types.js';
import {
  getLinkKey,
  rememberedRoomPassword,
  setRoomPassword,
  resolveRoomPassword,
  roomIsEncrypted,
  generateRoomKey,
  setLinkKey,
  roomShareUrl,
} from './roomKey.js';

const R = 'room-1' as RoomId;
beforeEach(() => localStorage.clear());

describe('getLinkKey', () => {
  it('reads the #k= hash fragment', () => {
    expect(getLinkKey({ hash: '#k=deadbeef' })).toBe('deadbeef');
  });
  it('is undefined without a key', () => {
    expect(getLinkKey({ hash: '' })).toBeUndefined();
    expect(getLinkKey({ hash: '#other=1' })).toBeUndefined();
  });
});

describe('remembered room password', () => {
  it('round-trips and clears', () => {
    expect(rememberedRoomPassword(R)).toBeUndefined();
    setRoomPassword(R, 'hunter2');
    expect(rememberedRoomPassword(R)).toBe('hunter2');
    setRoomPassword(R, null);
    expect(rememberedRoomPassword(R)).toBeUndefined();
  });
});

describe('resolveRoomPassword precedence', () => {
  it('prefers the link hash key over everything', () => {
    setRoomPassword(R, 'remembered');
    expect(resolveRoomPassword(R, { hash: '#k=fromlink' }, 'fromenv')).toBe('fromlink');
  });
  it('falls back to the remembered password', () => {
    setRoomPassword(R, 'remembered');
    expect(resolveRoomPassword(R, { hash: '' }, 'fromenv')).toBe('remembered');
  });
  it('falls back to the env password', () => {
    expect(resolveRoomPassword(R, { hash: '' }, 'fromenv')).toBe('fromenv');
  });
  it('is undefined when nothing is set', () => {
    expect(resolveRoomPassword(R, { hash: '' }, undefined)).toBeUndefined();
    expect(resolveRoomPassword(R, { hash: '' }, '')).toBeUndefined();
  });
  it('reports encryption state', () => {
    expect(roomIsEncrypted(R, { hash: '' })).toBe(false);
    expect(roomIsEncrypted(R, { hash: '#k=x' })).toBe(true);
  });
});

describe('generateRoomKey', () => {
  it('produces a 128-bit hex string', () => {
    const k = generateRoomKey();
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(generateRoomKey()).not.toBe(k);
  });
});

describe('setLinkKey', () => {
  it('writes and clears the hash via history.replaceState', () => {
    let captured = '';
    const hist = {
      replaceState: (_d: unknown, _t: string, u: string) => (captured = u),
    } as unknown as History;
    const loc = { pathname: '/copad/', search: '?room=x' };
    setLinkKey('abc', loc, hist);
    expect(captured).toBe('/copad/?room=x#k=abc');
    setLinkKey(null, loc, hist);
    expect(captured).toBe('/copad/?room=x');
  });
});

describe('roomShareUrl', () => {
  it('appends the hash key when present', () => {
    const loc = { origin: 'https://app.example', pathname: '/copad/', hash: '#k=abc' };
    expect(roomShareUrl(R, loc)).toBe('https://app.example/copad/?room=room-1#k=abc');
  });
  it('omits the hash when absent', () => {
    const loc = { origin: 'https://app.example', pathname: '/copad/', hash: '' };
    expect(roomShareUrl(R, loc)).toBe('https://app.example/copad/?room=room-1');
  });
});
