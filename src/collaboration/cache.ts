// A public room's cache holds PLAINTEXT Yjs state at rest; only an encrypted
// room's is unreadable without the key. The cached-rooms index exists because
// Firefox lacks `indexedDB.databases()`.

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { RoomId } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import { parseRoomList, parseLocalCacheEnabled } from './parse.js';
import { localStore } from '../persistence/local.js';
import { KEY_LOCAL_CACHE, KEY_CACHED_ROOMS, CACHE_DB_PREFIX, ENC_CACHE_DB_PREFIX } from './constants.js';
import { attachEncryptedCache } from './encryptedCache.js';

export type CacheDbName = string & { readonly _brand: 'CacheDbName' };

export type LocalCacheEnabled = boolean & { readonly _brand: 'LocalCacheEnabled' };

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

export function localCacheEnabled(): LocalCacheEnabled {
  return cacheEnabled.read();
}

export function setLocalCacheEnabled(on: boolean): void {
  cacheEnabled.write(on as LocalCacheEnabled);
}

export function cacheDbName(room: RoomId): CacheDbName {
  return `${CACHE_DB_PREFIX}${room}` as CacheDbName;
}

export function encCacheDbName(room: RoomId): CacheDbName {
  return `${ENC_CACHE_DB_PREFIX}${room}` as CacheDbName;
}

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
      // A blocked delete still completes once the open connection closes.
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearLocalCache(): Promise<void> {
  const rooms = cachedRooms.read();
  await Promise.all(
    rooms.flatMap((r) => [deleteDb(cacheDbName(r)), deleteDb(encCacheDbName(r))]),
  );
  cachedRooms.clear();
}

export interface LocalCache {
  destroy(): void;
}

export function attachLocalCache(room: RoomId, doc: Y.Doc, cred?: RoomCredential | null): LocalCache {
  rememberCachedRoom(room);
  if (cred) return attachEncryptedCache(room, doc, cred);
  const idb = new IndexeddbPersistence(cacheDbName(room), doc);
  return { destroy: () => void idb.destroy() };
}
