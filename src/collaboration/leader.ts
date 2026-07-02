/**
 * Autosave leader election, scoped per persistence target.
 *
 * The leader is the single peer that writes the shared document to storage,
 * elected as the lowest clientID — but only *among peers writing the same file*.
 * Peers with distinct targets (different backends, or different accounts of one
 * backend) each persist their own copy independently, so no owner's autosave is
 * starved by another's; peers writing the *same* file still elect one writer, so
 * a shared file (or the same user in two tabs) doesn't race itself.
 */

import type { StorageId, Filename } from '../storage/types.js';
import type { BrowserId } from './browserId.js';
import type { PersistTarget, PeerAwarenessState } from './types.js';

/**
 * The key two peers share **iff** they write the same physical file: same
 * browser + same backend + same filename. A hash (djb2 → hex) of those, so the
 * actual account/path/name never travels in awareness.
 */
export function persistTargetKey(browser: BrowserId, storage: StorageId, filename: Filename): PersistTarget {
  const s = `${browser}:${storage}:${filename}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16) as PersistTarget;
}

/**
 * Whether this peer is the leader for its target: the lowest clientID among all
 * peers persisting to the same target. Returns false when this peer isn't
 * persisting (no target). `min` starts at `selfId`, so a peer that isn't yet
 * reflected in `states` still wins when no lower-id peer shares its target.
 */
export function isPersistLeader(
  selfId: number,
  target: PersistTarget | undefined,
  states: ReadonlyMap<number, PeerAwarenessState>,
): boolean {
  if (!target) return false;
  let min = selfId;
  for (const [id, s] of states) {
    if (s.canPersist && s.persistTarget === target && id < min) min = id;
  }
  return min === selfId;
}
