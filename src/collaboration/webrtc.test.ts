import { describe, it, expect, vi } from 'vitest';

// Replace the real y-webrtc provider with a tiny event emitter we can drive.
vi.mock('y-webrtc', () => {
  class WebrtcProvider {
    awareness = { on() {}, getStates: () => new Map(), clientID: 1 };
    handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    connected = true;
    synced = false;
    // Mirror the real provider's room: peer presence is read from these.
    room = { webrtcConns: new Map<string, unknown>(), bcConns: new Set<string>() };
    opts: Record<string, unknown>;
    constructor(_room: string, _doc: unknown, opts: Record<string, unknown>) {
      this.opts = opts;
      (globalThis as Record<string, unknown>).__wp = this;
    }
    on(ev: string, fn: (...a: unknown[]) => void) {
      (this.handlers[ev] ||= []).push(fn);
    }
    emit(ev: string, arg?: unknown) {
      (this.handlers[ev] || []).forEach((fn) => fn(arg));
    }
    destroy() {}
  }
  return { WebrtcProvider };
});

// Capture IndexeddbPersistence construction without touching real IndexedDB.
vi.mock('y-indexeddb', () => {
  class IndexeddbPersistence {
    name: string;
    constructor(name: string, _doc: unknown) {
      this.name = name;
      (globalThis as Record<string, unknown>).__idb = this;
    }
    destroy() {
      return Promise.resolve();
    }
  }
  return { IndexeddbPersistence };
});

import { webrtcCollab } from './webrtc.js';
import type { RoomId, SignalingUrl } from './types.js';
import type { RoomCipher } from './roomCipher.js';
import type { LocalCacheEnabled } from './cache.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const provider = (): any => (globalThis as Record<string, unknown>).__wp;

const ROOM = 'room' as RoomId;
const SIGNALING = ['ws://x'] as SignalingUrl[];
const CACHE_ON = true as LocalCacheEnabled;

describe('webrtcCollab status mapping', () => {
  it('maps connecting → waiting → connected as signaling and peers change', () => {
    const collab = webrtcCollab({ signaling: SIGNALING })(ROOM);
    const seen: string[] = [];
    collab.onStatus((s) => seen.push(s));

    // Attached to signaling (connected=true) but no peers → 'waiting', not 'connected'.
    expect(seen[0]).toBe('waiting');

    // A peer joins → 'connected'.
    provider().room.webrtcConns.set('peer-1', {});
    provider().emit('peers', {});
    expect(seen.at(-1)).toBe('connected');

    // Signaling drops → 'connecting'.
    provider().connected = false;
    provider().emit('status', { connected: false });
    expect(seen.at(-1)).toBe('connecting');

    collab.destroy();
  });

  it('counts same-browser (BroadcastChannel) peers as connected', () => {
    const collab = webrtcCollab({ signaling: SIGNALING })(ROOM);
    let status = '';
    collab.onStatus((s) => (status = s));

    expect(status).toBe('waiting');
    provider().room.bcConns.add('tab-2');
    provider().emit('peers', {});
    expect(status).toBe('connected');

    collab.destroy();
  });

  it('tracks the synced flag', () => {
    const collab = webrtcCollab({ signaling: SIGNALING })(ROOM);
    let synced = true;
    collab.onSynced((b) => (synced = b));
    expect(synced).toBe(false); // initial

    provider().emit('synced', { synced: true });
    expect(synced).toBe(true);

    collab.destroy();
  });

  it('reports the p2p transport', () => {
    const collab = webrtcCollab({ signaling: SIGNALING })(ROOM);
    expect(collab.transport).toBe('p2p');
    collab.destroy();
  });
});

describe('webrtcCollab local cache', () => {
  it('attaches an IndexedDB cache named after the room when enabled', () => {
    (globalThis as Record<string, unknown>).__idb = undefined;
    webrtcCollab({ signaling: SIGNALING, cache: CACHE_ON })('my-room' as RoomId);
    expect(provider() && (globalThis as Record<string, unknown>).__idb).toBeTruthy();
    expect(((globalThis as Record<string, unknown>).__idb as { name: string }).name).toBe(
      'copad:my-room',
    );
  });

  it('skips the cache when not enabled', () => {
    (globalThis as Record<string, unknown>).__idb = undefined;
    webrtcCollab({ signaling: SIGNALING })(ROOM);
    expect((globalThis as Record<string, unknown>).__idb).toBeUndefined();
  });
});

describe('webrtcCollab cipher', () => {
  it('forwards cipher.password(room) to the provider as password', () => {
    const cipher: RoomCipher = { password: (room) => `key-for-${room}` };
    webrtcCollab({ signaling: SIGNALING, cipher })(ROOM);
    expect(provider().opts.password).toBe(`key-for-${ROOM}`);
  });

  it('passes undefined when no cipher is given', () => {
    webrtcCollab({ signaling: SIGNALING })(ROOM);
    expect(provider().opts.password).toBeUndefined();
  });

  it('passes undefined when cipher.password returns null (plaintext)', () => {
    const cipher: RoomCipher = { password: () => null };
    webrtcCollab({ signaling: SIGNALING, cipher })(ROOM);
    expect(provider().opts.password).toBeUndefined();
  });
});

describe('webrtcCollab ICE configuration', () => {
  it('forwards iceServers to the provider as peerOpts.config', () => {
    const ice = [{ urls: 'turn:t.example:3478', username: 'u', credential: 'c' }];
    webrtcCollab({ signaling: SIGNALING, iceServers: ice })(ROOM);
    expect(provider().opts.peerOpts).toEqual({ config: { iceServers: ice } });
  });

  it('omits peerOpts when no iceServers are given', () => {
    webrtcCollab({ signaling: SIGNALING })(ROOM);
    expect(provider().opts.peerOpts).toBeUndefined();
  });

  it('omits peerOpts when iceServers is empty', () => {
    webrtcCollab({ signaling: SIGNALING, iceServers: [] })(ROOM);
    expect(provider().opts.peerOpts).toBeUndefined();
  });
});
