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
import type { RoomCredential } from './roomAccess.js';
import { attachLocalCache, type LocalCache, type LocalCacheEnabled } from './cache.js';
import { CONNECT_TIMEOUT_MS } from './constants.js';

export interface CollabCoreOptions {
  doc: Y.Doc;
  room: RoomId;
  /** Mirror the doc into IndexedDB so it survives a reload without a backend. */
  cache?: LocalCacheEnabled;
  /** Room credential — when present, the local cache is encrypted at rest with a
   *  key derived from it, matching the transport encryption. */
  cacheKey?: RoomCredential;
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
  /** Clear the "can't connect" timeout and rearm a fresh grace window. Call at
   *  the start of a manual `reconnect()` so a user-initiated retry gets the
   *  full window again instead of instantly re-reporting `Unreachable`. */
  resetConnectTimeout(): void;
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
  // Encrypted at rest when a room credential is present (see attachLocalCache).
  const cache: LocalCache | undefined = opts.cache
    ? attachLocalCache(opts.room, opts.doc, opts.cacheKey)
    : undefined;

  // Being attached to the server does NOT imply a peer is present, so we report
  // `connecting` until attached, then `waiting` while alone in the room, and only
  // `connected` once another peer appears. That distinction tells a user whether
  // the transport is broken (stuck on `connecting`) or nobody else has joined yet.
  //
  // `connecting` on its own can't tell "still trying" apart from "will never
  // attach" (dead/misconfigured server) — both look identical: not attached,
  // spinner forever. `timedOut` closes that gap: once CONNECT_TIMEOUT_MS has
  // passed with no successful attach, computeStatus reports `Unreachable`
  // instead, so the UI can stop spinning and show an actionable state.
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  // Arms/disarms the timeout window to match the current attach/network state.
  // Attached, or offline (nothing to time out while there's no network at all),
  // clears any pending timer and resets `timedOut`; still trying while online
  // arms a fresh timer unless one is already running or has already fired.
  const syncTimer = (): void => {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online || isAttached()) {
      clearTimer();
      timedOut = false;
      return;
    }
    if (timer === undefined && !timedOut) {
      timer = setTimeout(() => {
        timer = undefined;
        timedOut = true;
        emitStatus();
      }, CONNECT_TIMEOUT_MS);
    }
  };

  const computeStatus = (): ConnStatus => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return ConnStatus.Offline;
    if (!isAttached()) return timedOut ? ConnStatus.Unreachable : ConnStatus.Connecting;
    return peerCount() > 0 ? ConnStatus.Connected : ConnStatus.Waiting;
  };

  const emitStatus = (): void => {
    syncTimer();
    const s = computeStatus();
    statusFns.forEach((fn) => fn(s));
  };

  // Arm the initial window immediately — `onStatus` computes its first value
  // directly (not through `emitStatus`), so without this a core created while
  // already not-attached would never start its clock until the first provider
  // event fired.
  syncTimer();

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
    resetConnectTimeout() {
      clearTimer();
      timedOut = false;
      syncTimer();
    },
    destroy() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onNetwork);
        window.removeEventListener('offline', onNetwork);
      }
      clearTimer();
      statusFns.clear();
      syncedFns.clear();
      cache?.destroy();
    },
  };
}
