import type { StorageId, Filename } from '../storage/types.js';
import type { BrowserId } from './browserId.js';
import type { PersistTarget, PeerAwarenessState, ClientId } from './types.js';

/** Hashed so the account, path and name never travel in awareness. */
export function persistTargetKey(browser: BrowserId, storage: StorageId, filename: Filename): PersistTarget {
  const s = `${browser}:${storage}:${filename}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16) as PersistTarget;
}

/** `min` starts at `selfId` so a peer absent from its own `states` still wins. */
export function isPersistLeader(
  selfId: ClientId,
  target: PersistTarget | undefined,
  states: ReadonlyMap<ClientId, PeerAwarenessState>,
): boolean {
  if (!target) return false;
  let min = selfId;
  for (const [id, s] of states) {
    if (s.canPersist && s.persistTarget === target && id < min) min = id;
  }
  return min === selfId;
}
