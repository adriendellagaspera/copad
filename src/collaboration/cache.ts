// Local document cache (IndexedDB) preferences + bookkeeping.
//
// y-indexeddb mirrors the shared Y.Doc into the browser's IndexedDB so a doc
// survives a reload even with no storage backend connected. This module owns:
//  - the on/off preference (default ON),
//  - the IndexedDB database name (namespaced so we can find/clear only ours),
//  - a small index of which rooms have been cached, so "clear" works in every
//    browser (we don't rely on indexedDB.databases(), which Firefox lacks).
//
// Privacy note: the cache stores PLAINTEXT Yjs state at rest, regardless of any
// room password (that only encrypts transport). The on/off toggle is the control.

import type * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

const KEY_ENABLED = 'copad:localCache';
const KEY_ROOMS = 'copad:cachedRooms';
const DB_PREFIX = 'copad:';

/** Whether the local document cache is on for a session — a branded boolean so
 *  the adapter `cache` option can't be confused with any other on/off flag. */
export type LocalCacheEnabled = boolean & { readonly _brand: 'LocalCacheEnabled' };

/** Whether documents should be cached locally. Defaults to true (anything but '0'). */
export function localCacheEnabled(): LocalCacheEnabled {
  try {
    return (localStorage.getItem(KEY_ENABLED) !== '0') as LocalCacheEnabled;
  } catch {
    return true as LocalCacheEnabled;
  }
}

export function setLocalCacheEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY_ENABLED, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** IndexedDB database name for a room — namespaced so "clear" only touches ours. */
export function cacheDbName(room: string): string {
  return DB_PREFIX + room;
}

function readRooms(): string[] {
  try {
    const raw = localStorage.getItem(KEY_ROOMS);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

/** Record that a room has a local cache, so clearLocalCache() can find it later. */
export function rememberCachedRoom(room: string): void {
  try {
    const rooms = readRooms();
    if (!rooms.includes(room)) {
      rooms.push(room);
      localStorage.setItem(KEY_ROOMS, JSON.stringify(rooms));
    }
  } catch {
    /* ignore */
  }
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      // Resolve on any terminal outcome — a blocked delete still completes once
      // the live connection (an open editor) closes, so we don't want to hang.
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Delete every cached document and forget the index. */
export async function clearLocalCache(): Promise<void> {
  const rooms = readRooms();
  await Promise.all(rooms.map((r) => deleteDb(cacheDbName(r))));
  try {
    localStorage.removeItem(KEY_ROOMS);
  } catch {
    /* ignore */
  }
}

/** A handle to a doc's attached local cache; call destroy() to detach. */
export interface LocalCache {
  destroy(): void;
}

/**
 * Mirror a doc into IndexedDB (namespaced per room) and remember the room so a
 * later clearLocalCache() can find it. Returns a handle to detach on teardown.
 * This is the single place that touches y-indexeddb — transport adapters just
 * ask for a LocalCache, staying decoupled from the storage mechanism.
 */
export function attachLocalCache(room: string, doc: Y.Doc): LocalCache {
  const idb = new IndexeddbPersistence(cacheDbName(room), doc);
  rememberCachedRoom(room);
  return { destroy: () => void idb.destroy() };
}
