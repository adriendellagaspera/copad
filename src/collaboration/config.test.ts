import { describe, it, expect, vi } from 'vitest';
import { resolveSignaling, resolveIceServers, resolveWebsocket, resolveTransport, resolveRoomStrategy, type PageProtocol, type PageHostname } from './config.js';
import type { RoomId } from './types.js';

// Stubs for secretLink (called when VITE_ROOM_AUTH=secret-link)
vi.stubGlobal('location', { hash: '' });
vi.stubGlobal('history', { replaceState: vi.fn() });
vi.stubGlobal('crypto', { randomUUID: () => 'stub-uuid' });

const https = { protocol: 'https:' as PageProtocol, hostname: 'app.example.com' as PageHostname };
const localhttp = { protocol: 'http:' as PageProtocol, hostname: 'localhost' as PageHostname };

describe('resolveTransport', () => {
  it('defaults to webrtc when unset', () => {
    expect(resolveTransport(undefined)).toBe('webrtc');
    expect(resolveTransport('')).toBe('webrtc');
  });
  it('selects websocket only on an explicit value (case-insensitive)', () => {
    expect(resolveTransport('websocket')).toBe('websocket');
    expect(resolveTransport('  WebSocket ')).toBe('websocket');
  });
  it('falls back to webrtc for any other value', () => {
    expect(resolveTransport('webrtc')).toBe('webrtc');
    expect(resolveTransport('ws')).toBe('webrtc');
    expect(resolveTransport('hub')).toBe('webrtc');
  });
});

describe('resolveSignaling', () => {
  it('defaults to the local dev server on a local host', () => {
    const r = resolveSignaling(undefined, localhttp);
    expect(r.servers).toEqual(['ws://localhost:4444']);
    expect(r.warning).toBeUndefined();
  });

  it('warns and configures no servers when unset on a deployed origin', () => {
    const r = resolveSignaling(undefined, https);
    expect(r.servers).toEqual([]);
    expect(r.warning).toBeDefined();
    expect(r.technicalWarning).toMatch(/VITE_SIGNALING_URL/);
  });

  it('warns when every configured server is insecure ws:// on https', () => {
    const r = resolveSignaling('ws://localhost:4444', https);
    expect(r.servers).toEqual(['ws://localhost:4444']);
    expect(r.warning).toMatch(/mixed content/i);
  });

  it('warns about the insecure subset when only some servers are ws://', () => {
    const r = resolveSignaling('wss://sig.example, ws://nope', https);
    expect(r.servers).toEqual(['wss://sig.example', 'ws://nope']);
    expect(r.warning).toMatch(/ws:\/\/nope/);
  });

  it('accepts a wss:// server on https without warning', () => {
    const r = resolveSignaling('wss://sig.example', https);
    expect(r.servers).toEqual(['wss://sig.example']);
    expect(r.warning).toBeUndefined();
  });

  it('trims and splits a comma-separated list', () => {
    const r = resolveSignaling(' wss://a ,, wss://b ', https);
    expect(r.servers).toEqual(['wss://a', 'wss://b']);
  });
});

describe('resolveWebsocket', () => {
  it('is not selected when no URL is configured', () => {
    const r = resolveWebsocket(undefined, https);
    expect(r.url).toBeUndefined();
    expect(r.warning).toBeUndefined();
  });

  it('url is undefined for an empty string input', () => {
    const r = resolveWebsocket('', https);
    expect(r.url).toBeUndefined();
    expect(r.warning).toBeUndefined();
  });

  it('url is undefined for a whitespace-only input', () => {
    const r = resolveWebsocket('   ', https);
    expect(r.url).toBeUndefined();
    expect(r.warning).toBeUndefined();
  });

  it('selects the configured wss:// server without warning', () => {
    const r = resolveWebsocket('wss://hub.example', https);
    expect(r.url).toBe('wss://hub.example');
    expect(r.warning).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    const r = resolveWebsocket('  wss://hub.example  ', https);
    expect(r.url).toBe('wss://hub.example');
  });

  it('warns when ws:// is used on an https page (mixed content)', () => {
    const r = resolveWebsocket('ws://hub.example', https);
    expect(r.url).toBe('ws://hub.example');
    expect(r.warning).toMatch(/mixed content/i);
  });

  it('allows ws:// on a local http page', () => {
    const r = resolveWebsocket('ws://localhost:1234', localhttp);
    expect(r.url).toBe('ws://localhost:1234');
    expect(r.warning).toBeUndefined();
  });
});

describe('resolveIceServers', () => {
  it('returns the default public STUN server when nothing is set', () => {
    expect(resolveIceServers({})).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
  });

  it('appends a TURN server with credentials when configured', () => {
    const ice = resolveIceServers({
      VITE_TURN_URL: 'turn:relay.example:3478',
      VITE_TURN_USERNAME: 'user',
      VITE_TURN_CREDENTIAL: 'secret',
    });
    expect(ice).toEqual([
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['turn:relay.example:3478'], username: 'user', credential: 'secret' },
    ]);
  });

  it('allows overriding STUN and supports comma-separated TURN urls', () => {
    const ice = resolveIceServers({
      VITE_STUN_URL: 'stun:stun.example:3478',
      VITE_TURN_URL: 'turn:a.example:3478, turns:a.example:5349',
    });
    expect(ice).toEqual([
      { urls: ['stun:stun.example:3478'] },
      { urls: ['turn:a.example:3478', 'turns:a.example:5349'] },
    ]);
  });

  it('disables STUN when explicitly set to empty', () => {
    expect(resolveIceServers({ VITE_STUN_URL: '' })).toEqual([]);
  });
});

const ROOM = 'r' as RoomId;

describe('resolveRoomStrategy — access', () => {
  it('defaults to publicAccess when unset', () => {
    const { access } = resolveRoomStrategy(undefined);
    expect(access.mode).toBe('public');
    expect(access.credential(ROOM)).toBeNull();
  });

  it('defaults to public for empty string', () => {
    expect(resolveRoomStrategy('').access.mode).toBe('public');
  });

  it('defaults to public for unknown values (typo safety)', () => {
    expect(resolveRoomStrategy('password').access.mode).toBe('public');
    expect(resolveRoomStrategy('webrtc').access.mode).toBe('public');
  });

  it('selects site-password mode', () => {
    expect(resolveRoomStrategy('site-password').access.mode).toBe('site-password');
  });

  it('selects room-password mode', () => {
    expect(resolveRoomStrategy('room-password').access.mode).toBe('room-password');
  });

  it('selects secret-link mode', () => {
    expect(resolveRoomStrategy('secret-link').access.mode).toBe('secret-link');
  });

  it('is case-insensitive', () => {
    expect(resolveRoomStrategy('Public').access.mode).toBe('public');
    expect(resolveRoomStrategy('SITE-PASSWORD').access.mode).toBe('site-password');
  });

  it('trims whitespace', () => {
    expect(resolveRoomStrategy('  room-password  ').access.mode).toBe('room-password');
  });
});

describe('resolveRoomStrategy — cipher', () => {
  it('publicAccess → plaintext (null password)', () => {
    const { cipher } = resolveRoomStrategy('public');
    expect(cipher.password(ROOM)).toBeNull();
  });

  it('secret-link → cipher and access share key material (dual port)', () => {
    const { access, cipher } = resolveRoomStrategy('secret-link');
    expect(cipher.password(ROOM)).toBe(access.credential(ROOM));
  });

  it('site-password → cipher delegates to access.credential', () => {
    // No VITE_ROOM_PASSWORD in test env → sitePassword('') → null
    const { access, cipher } = resolveRoomStrategy('site-password');
    expect(cipher.password(ROOM)).toBe(access.credential(ROOM));
  });
});
