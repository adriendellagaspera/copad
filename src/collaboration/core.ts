// The transport-agnostic half of a Collab session.
//
// webrtcCollab and websocketCollab differ only in how they talk to their
// provider (event names, "am I attached?", "how many peers?") — everything
// downstream of that is identical: the status/synced subscriber fan-out, the
// connecting→waiting→connected status machine, reacting to the browser going
// on/offline, the local-cache lifecycle, and teardown. That shared half lives
// here; each adapter supplies two small hooks and wires its provider's events
// to `emitStatus`/`setSynced`.

import type * as Y from 'yjs';
import type { RoomId } from './types.js';
import { ConnStatus } from './types.js';
import { attachLocalCache, type LocalCache, type LocalCacheEnabled } from './cache.js';

export interface CollabCoreOptions {
  doc: Y.Doc;
  room: RoomId;
  /** Mirror the doc into IndexedDB so it survives a reload without a backend. */
  cache?: LocalCacheEnabled;
  /** True once attached to the signaling / relay server — not necessarily peered. */
  isAttached: () => boolean;
  /** Number of *other* peers currently present (0 = alone in the room). */
  peerCount: () => number;
}

export interface CollabCore {
  onStatus(fn: (status: ConnStatus) => void): () => void;
  onSynced(fn: (synced: boolean) => void): () => void;
  /** Recompute and broadcast the connection status — call from provider events. */
  emitStatus(): void;
  /** Update and broadcast the synced flag — call from the provider's sync event. */
  setSynced(value: boolean): void;
  /** Remove network listeners, drop subscribers and detach the local cache. Call
   *  BEFORE the provider/doc are destroyed so the IndexedDB connection is closed
   *  first (a subsequent "clear local copies" would otherwise be blocked). */
  destroy(): void;
}

export function createCollabCore(opts: CollabCoreOptions): CollabCore {
  const { isAttached, peerCount } = opts;
  const statusFns = new Set<(s: ConnStatus) => void>();
  const syncedFns = new Set<(b: boolean) => void>();
  let synced = false;

  // Local cache: keeps the doc across reloads even with no storage backend.
  const cache: LocalCache | undefined = opts.cache
    ? attachLocalCache(opts.room, opts.doc)
    : undefined;

  // Being attached to the server does NOT imply a peer is present, so we report
  // `connecting` until attached, then `waiting` while alone in the room, and only
  // `connected` once another peer appears. That distinction tells a user whether
  // the transport is broken (stuck on `connecting`) or nobody else has joined yet.
  const computeStatus = (): ConnStatus => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return ConnStatus.Offline;
    if (!isAttached()) return ConnStatus.Connecting;
    return peerCount() > 0 ? ConnStatus.Connected : ConnStatus.Waiting;
  };

  const emitStatus = (): void => {
    const s = computeStatus();
    statusFns.forEach((fn) => fn(s));
  };

  const onNetwork = (): void => emitStatus();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
  }

  return {
    onStatus(fn) {
      statusFns.add(fn);
      fn(computeStatus());
      return () => statusFns.delete(fn);
    },
    onSynced(fn) {
      syncedFns.add(fn);
      fn(synced);
      return () => syncedFns.delete(fn);
    },
    emitStatus,
    setSynced(value) {
      synced = value;
      syncedFns.forEach((fn) => fn(value));
    },
    destroy() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onNetwork);
        window.removeEventListener('offline', onNetwork);
      }
      statusFns.clear();
      syncedFns.clear();
      cache?.destroy();
    },
  };
}
