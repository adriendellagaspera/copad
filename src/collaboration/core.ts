import type * as Y from 'yjs';
import type { RoomId, RoomPresence } from './types.js';
import { ConnStatus, PresenceKind } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import { attachLocalCache, type LocalCache, type LocalCacheEnabled } from './cache.js';
import { CONNECT_TIMEOUT_MS } from './constants.js';

export interface CollabCoreOptions {
  doc: Y.Doc;
  room: RoomId;
  cache?: LocalCacheEnabled;
  cacheKey?: RoomCredential;
  isAttached: () => boolean;
  peerCount: () => number;
  // Omit on transports with no such state (e.g. the hub).
  reachingCount?: () => number;
}

export interface CollabCore {
  onStatus(fn: (status: ConnStatus) => void): () => void;
  onSynced(fn: (synced: boolean) => void): () => void;
  onPresence(fn: (presence: RoomPresence) => void): () => void;
  emitStatus(): void;
  setSynced(value: boolean): void;
  resetConnectTimeout(): void;
  // Call before the provider/doc are destroyed: closes IndexedDB, or a later "clear local copies" would be blocked.
  destroy(): void;
}

export function createCollabCore(opts: CollabCoreOptions): CollabCore {
  const { isAttached, peerCount, reachingCount } = opts;
  const statusFns = new Set<(s: ConnStatus) => void>();
  const syncedFns = new Set<(b: boolean) => void>();
  const presenceFns = new Set<(p: RoomPresence) => void>();
  let synced = false;

  const cache: LocalCache | undefined = opts.cache
    ? attachLocalCache(opts.room, opts.doc, opts.cacheKey)
    : undefined;

  // `connecting` can't tell "still trying" from a dead server (both spin forever); `timedOut` closes that gap
  // past CONNECT_TIMEOUT_MS with no attach.
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

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

  // Offline or not-attached => Unknown, not Alone: never lock on ignorance.
  const computePresenceKind = (): PresenceKind => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return PresenceKind.Unknown;
    if (!isAttached()) return PresenceKind.Unknown;
    if (peerCount() > 0) return PresenceKind.Accompanied;
    if (reachingCount && reachingCount() > 0) return PresenceKind.Reaching;
    return PresenceKind.Alone;
  };

  // Memoised: same kind => same object, so a grace timer keyed on identity doesn't restart on every awareness sweep.
  let presence: RoomPresence = { kind: computePresenceKind() };
  const emitPresence = (): void => {
    const kind = computePresenceKind();
    if (kind === presence.kind) return;
    presence = { kind };
    presenceFns.forEach((fn) => fn(presence));
  };

  const emitStatus = (): void => {
    syncTimer();
    const s = computeStatus();
    statusFns.forEach((fn) => fn(s));
    emitPresence();
  };

  // onStatus computes its first value directly, not via emitStatus — a not-yet-attached core needs this to
  // start its clock.
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
    onPresence(fn) {
      presenceFns.add(fn);
      fn(presence);
      return () => presenceFns.delete(fn);
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
      presenceFns.clear();
      cache?.destroy();
    },
  };
}
