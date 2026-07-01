import { describe, it, expect, vi } from 'vitest';

// Replace the real y-webrtc provider with a tiny event emitter we can drive.
vi.mock('y-webrtc', () => {
  // A stand-in for y-webrtc's SignalingConn (a lib0 WebsocketClient): a live
  // `connected` flag plus connect/disconnect events the adapter binds to.
  class FakeSignalingConn {
    connected = true;
    handlers: Record<string, (() => void)[]> = {};
    on(ev: string, fn: () => void) {
      (this.handlers[ev] ||= []).push(fn);
    }
    off(ev: string, fn: () => void) {
      this.handlers[ev] = (this.handlers[ev] || []).filter((f) => f !== fn);
    }
    emit(ev: string) {
      (this.handlers[ev] || []).forEach((fn) => fn());
    }
  }
  class WebrtcProvider {
    awareness = { on() {}, getStates: () => new Map(), clientID: 1 };
    handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    connected = true;
    synced = false;
    // Signaling sockets — attachment is read from these `connected` flags now,
    // not from `provider.connected` (which is true from construction).
    signalingConns = [new FakeSignalingConn()];
    // Mirror the real provider's room: peer presence is read from these.
    room = { webrtcConns: new Map<string, unknown>(), bcConns: new Set<string>() };
    opts: Record<string, unknown>;
    constructor(_room: string, _doc: unknown, opts: Record<string, unknown>) {
      this.opts = opts;
      (globalThis as Record<string, unknown>).__wp = this;
    }
    disconnectCount = 0;
    connectCount = 0;
    on(ev: string, fn: (...a: unknown[]) => void) {
      (this.handlers[ev] ||= []).push(fn);
    }
    emit(ev: string, arg?: unknown) {
      (this.handlers[ev] || []).forEach((fn) => fn(arg));
    }
    disconnect() {
      this.disconnectCount++;
    }
    connect() {
      this.connectCount++;
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
import type { RoomCredential } from './roomAccess.js';
import type { LocalCacheEnabled } from './cache.js';
import { parseTurnUrl, parseTurnUsername, parseTurnCredential } from './parse.js';

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

    // Peer leaves AND signaling drops → 'connecting'. (A live peer keeps the
    // session 'connected' through a signaling hiccup — discovery is down, but
    // the p2p link isn't — so both must be gone to fall back to 'connecting'.)
    provider().room.webrtcConns.clear();
    provider().signalingConns[0].connected = false;
    provider().signalingConns[0].emit('disconnect');
    expect(seen.at(-1)).toBe('connecting');

    collab.destroy();
  });

  it('stays "connecting" while every signaling handshake is failing, then flips to "waiting" once a socket connects', () => {
    // Regression: `provider.connected` is true from construction, so the pill used
    // to show "waiting/no peers" against a cold signaling server that hadn't
    // actually accepted a connection yet. Attachment must track the real socket.
    const collab = webrtcCollab({ signaling: SIGNALING })(ROOM);
    provider().signalingConns[0].connected = false; // cold server: handshake failing
    const seen: string[] = [];
    collab.onStatus((s) => seen.push(s));

    // No signaling socket up and no peers → honestly "connecting", not "waiting".
    expect(seen[0]).toBe('connecting');

    // The server wakes and the socket connects → the adapter bridges the event
    // into the status machine, flipping to "waiting" with no peer/room change.
    provider().signalingConns[0].connected = true;
    provider().signalingConns[0].emit('connect');
    expect(seen.at(-1)).toBe('waiting');

    collab.destroy();
  });

  it('unbinds signaling listeners on destroy (shared conns outlive the collab)', () => {
    const collab = webrtcCollab({ signaling: SIGNALING })(ROOM);
    const conn = provider().signalingConns[0];
    collab.destroy();
    // After destroy, a socket flap must not reach the (torn-down) status machine.
    expect(conn.handlers['connect']).toEqual([]);
    expect(conn.handlers['disconnect']).toEqual([]);
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
    const cipher: RoomCipher = { password: (room) => `key-for-${room}` as RoomCredential };
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

describe('webrtcCollab reconnect & diagnostics', () => {
  it('reconnect drops and re-attaches the provider', () => {
    const collab = webrtcCollab({ signaling: SIGNALING })(ROOM);
    collab.reconnect?.();
    expect(provider().disconnectCount).toBe(1);
    expect(provider().connectCount).toBe(1);
    collab.destroy();
  });

  it('getDiagnostics reports transport, signaling and peer count', async () => {
    const collab = webrtcCollab({ signaling: SIGNALING })(ROOM);
    const d = await collab.getDiagnostics?.();
    expect(d?.transport).toBe('p2p');
    expect(d?.signaling).toBe(true);
    expect(d?.peers).toBe(0);
    expect(d?.connections).toEqual([]);
    collab.destroy();
  });
});

describe('webrtcCollab ICE configuration', () => {
  it('forwards iceServers to the provider as peerOpts.config', () => {
    const ice = [{
      urls: [parseTurnUrl('turn:t.example:3478')!],
      username: parseTurnUsername('u'),
      credential: parseTurnCredential('c'),
    }];
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
