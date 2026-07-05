// Local document cache (IndexedDB) preferences + bookkeeping.
//
// y-indexeddb mirrors the shared Y.Doc into the browser's IndexedDB so a doc
// survives a reload even with no storage backend connected. This module owns:
//  - the on/off preference (default ON),
//  - the IndexedDB database name (namespaced so we can find/clear only ours),
//  - a small index of which rooms have been cached, so "clear" works in every
//    browser (we don't rely on indexedDB.databases(), which Firefox lacks).
//
// Privacy note: for a public room the cache stores PLAINTEXT Yjs state at rest;
// for an encrypted room it's AES-GCM encrypted at rest with a key derived from
// the room credential (see encryptedCache.ts), so a cached doc can't be read back
// without the key. The on/off toggle + "Clear local copies" remain the controls.

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { RoomId } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import { parseRoomList, parseLocalCacheEnabled } from './parse.js';
import { localStore } from '../persistence/local.js';
import { KEY_LOCAL_CACHE, KEY_CACHED_ROOMS, CACHE_DB_PREFIX, ENC_CACHE_DB_PREFIX } from './constants.js';
import { attachEncryptedCache, loadEncryptedInto, writeEncryptedSnapshot } from './encryptedCache.js';

/** An IndexedDB database name produced by {@link cacheDbName} — namespaced under the app prefix. */
export type CacheDbName = string & { readonly _brand: 'CacheDbName' };

/** Whether the local document cache is on for a session — a branded boolean so
 *  the adapter `cache` option can't be confused with any other on/off flag. */
export type LocalCacheEnabled = boolean & { readonly _brand: 'LocalCacheEnabled' };

// localStorage + parsing are abstracted behind these stores: the functions below
// only read/write typed values, never touching localStorage or a parser directly.
const cacheEnabled = localStore<LocalCacheEnabled>(
  KEY_LOCAL_CACHE,
  parseLocalCacheEnabled,
  (on) => (on ? '1' : '0'),
);
const cachedRooms = localStore<RoomId[]>(
  KEY_CACHED_ROOMS,
  parseRoomList,
  (rooms) => JSON.stringify(rooms),
);

/** Whether documents should be cached locally. Defaults to true (anything but '0'). */
export function localCacheEnabled(): LocalCacheEnabled {
  return cacheEnabled.read();
}

export function setLocalCacheEnabled(on: boolean): void {
  cacheEnabled.write(on as LocalCacheEnabled);
}

/** IndexedDB database name for a room — namespaced so "clear" only touches ours. */
export function cacheDbName(room: RoomId): CacheDbName {
  return `${CACHE_DB_PREFIX}${room}` as CacheDbName;
}

/** IndexedDB database name for a room's *encrypted* cache. */
export function encCacheDbName(room: RoomId): CacheDbName {
  return `${ENC_CACHE_DB_PREFIX}${room}` as CacheDbName;
}

/** Record that a room has a local cache, so clearLocalCache() can find it later. */
export function rememberCachedRoom(room: RoomId): void {
  const rooms = cachedRooms.read();
  if (!rooms.includes(room)) {
    rooms.push(room);
    cachedRooms.write(rooms);
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

/** Delete every cached document (plaintext *and* encrypted) and forget the index. */
export async function clearLocalCache(): Promise<void> {
  const rooms = cachedRooms.read();
  await Promise.all(
    rooms.flatMap((r) => [deleteDb(cacheDbName(r)), deleteDb(encCacheDbName(r))]),
  );
  cachedRooms.clear();
}

/** Load a room's plaintext (y-indexeddb) cache into a scratch doc, then detach. */
async function loadPlaintextInto(doc: Y.Doc, room: RoomId): Promise<void> {
  const idb = new IndexeddbPersistence(cacheDbName(room), doc);
  try {
    await idb.whenSynced;
  } finally {
    await idb.destroy(); // closes the connection; does not delete the data
  }
}

/** Write a scratch doc's state into a room's plaintext cache, then detach. */
async function writePlaintextSnapshot(doc: Y.Doc, room: RoomId): Promise<void> {
  const idb = new IndexeddbPersistence(cacheDbName(room), doc);
  try {
    await idb.whenSynced;
  } finally {
    await idb.destroy();
  }
}

/**
 * Move a room's local cache from one key to another when its encryption changes,
 * so content survives the switch *and* no copy is left readable under the old
 * scheme. `from`/`to` are the old/new room credentials (`null` = plaintext).
 *
 * Both keys are known at the moment encryption is changed (in the Share dialog),
 * which is the only time an encrypted source can be decrypted — hence migration
 * happens there, before the editor reconnects under the new key. A no-op when the
 * key is unchanged or the local cache is turned off.
 */
export async function migrateRoomCache(
  room: RoomId,
  from: RoomCredential | null,
  to: RoomCredential | null,
): Promise<void> {
  if (from === to || !localCacheEnabled()) return;
  const scratch = new Y.Doc();
  try {
    // Read the current content out of the old cache…
    if (from) await loadEncryptedInto(scratch, room, from);
    else await loadPlaintextInto(scratch, room);
    // …write it into the new one…
    if (to) await writeEncryptedSnapshot(scratch, room, to);
    else await writePlaintextSnapshot(scratch, room);
    // …and delete the old store when it's a different database (plaintext ⇄
    // encrypted). A key rotation (encrypted → encrypted) reuses the same database,
    // which writeEncryptedSnapshot already overwrote, so there's nothing to drop.
    if ((from != null) !== (to != null)) {
      await deleteDb(from ? encCacheDbName(room) : cacheDbName(room));
    }
    rememberCachedRoom(room);
  } finally {
    scratch.destroy();
  }
}

/** A handle to a doc's attached local cache; call destroy() to detach. */
export interface LocalCache {
  destroy(): void;
}

/**
 * Mirror a doc into IndexedDB (namespaced per room) and remember the room so a
 * later clearLocalCache() can find it. Returns a handle to detach on teardown.
 *
 * When a room `cred` is supplied the cache is AES-GCM encrypted at rest (keyed by
 * the credential) so it can't be read back without the key — mirroring the
 * transport encryption. Without a credential (public room) it stays the plain
 * y-indexeddb mirror. Transport adapters just ask for a LocalCache and stay
 * decoupled from which mechanism is used.
 */
export function attachLocalCache(room: RoomId, doc: Y.Doc, cred?: RoomCredential | null): LocalCache {
  rememberCachedRoom(room);
  if (cred) return attachEncryptedCache(room, doc, cred);
  const idb = new IndexeddbPersistence(cacheDbName(room), doc);
  return { destroy: () => void idb.destroy() };
}
