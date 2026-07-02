// AES-GCM-encrypted local document cache.
//
// The plaintext cache (`cache.ts`, backed by y-indexeddb) mirrors the Y.Doc into
// IndexedDB in the clear — fine for a public room, a privacy hole for an
// encrypted one: removing the key and reloading would still show the cached
// plaintext. This module is the encrypted counterpart, used automatically when a
// room has a key: every Yjs update is encrypted (key derived from the room
// credential) before it touches IndexedDB, so the at-rest bytes are unreadable
// without the key. Reusing y-indexeddb wasn't possible — it has no hook to
// transform bytes on the way in/out — so this is a deliberately small,
// append-log persistence over raw IndexedDB.

import * as Y from 'yjs';
import type { RoomId } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import type { LocalCache } from './cache.js';
import { ENC_CACHE_DB_PREFIX } from './constants.js';
import {
  deriveCacheKey,
  encryptUpdate,
  decryptUpdate,
  type EncryptedRecord,
} from './roomCrypto.js';

const STORE = 'updates';
// After this many in-session appends, fold the log back into a single snapshot
// so an encrypted cache can't grow without bound across a long editing session.
const COMPACT_EVERY = 50;

// Distinguishes updates we apply while *loading* the cache from genuine local
// edits, so restoring the cache doesn't immediately re-persist what we just read.
const LOAD_ORIGIN = Symbol('encrypted-cache-load');

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexeddb blocked'));
  });
}

function readAll(db: IDBDatabase): Promise<EncryptedRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as EncryptedRecord[]);
    req.onerror = () => reject(req.error);
  });
}

function append(db: IDBDatabase, rec: EncryptedRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Replace the whole log with a single record — the compacted snapshot. */
function replaceAll(db: IDBDatabase, rec: EncryptedRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    store.add(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Empty the log — used to drop records left by a *different* key (a key change). */
function clearStore(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Mirror a doc into an encrypted IndexedDB store, keyed by the room credential.
 * Returns immediately with a handle; loading + key derivation happen async (like
 * y-indexeddb). `destroy()` detaches, and is safe to call before init finishes.
 */
export function attachEncryptedCache(room: RoomId, doc: Y.Doc, cred: RoomCredential): LocalCache {
  const dbName = ENC_CACHE_DB_PREFIX + room;
  let db: IDBDatabase | undefined;
  let key: CryptoKey | undefined;
  let destroyed = false;
  let sinceCompact = 0;

  const persist = async (update: Uint8Array): Promise<void> => {
    if (!db || !key) return;
    try {
      await append(db, await encryptUpdate(key, update));
      if (++sinceCompact >= COMPACT_EVERY) {
        sinceCompact = 0;
        await replaceAll(db, await encryptUpdate(key, Y.encodeStateAsUpdate(doc)));
      }
    } catch {
      /* best-effort cache — a failed write must never break editing */
    }
  };

  // Yjs hands the update handler a (update, origin) pair; ignore our own load
  // writes so restoring the cache doesn't echo straight back into it.
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN) return;
    void persist(update);
  };

  void (async () => {
    try {
      key = await deriveCacheKey(cred);
      const opened = await openDb(dbName);
      if (destroyed) {
        opened.close();
        return;
      }
      db = opened;

      const records = await readAll(db);
      const updates: Uint8Array[] = [];
      for (const rec of records) {
        const plain = await decryptUpdate(key, rec);
        if (plain) updates.push(plain);
      }
      if (updates.length && !destroyed) {
        // Apply all restored updates in one transaction, tagged so onUpdate skips them.
        Y.transact(doc, () => {
          for (const u of updates) Y.applyUpdate(doc, u, LOAD_ORIGIN);
        }, LOAD_ORIGIN);
        // Fold the restored log into a single snapshot to bound on-disk growth.
        await replaceAll(db, await encryptUpdate(key, Y.encodeStateAsUpdate(doc)));
      } else if (records.length && !destroyed) {
        // Records exist but none decrypted — they were written under a different
        // key (the room's key changed). Drop them so we start clean under this key
        // and old content can't resurface if the previous key comes back.
        await clearStore(db);
      }

      if (destroyed) {
        db.close();
        return;
      }
      doc.on('update', onUpdate);
    } catch {
      /* private mode / blocked IndexedDB — the cache simply stays inactive */
    }
  })();

  return {
    destroy() {
      destroyed = true;
      doc.off('update', onUpdate);
      db?.close();
      db = undefined;
    },
  };
}

/**
 * Load an encrypted cache's contents into `doc` (decrypting with `cred`). Used by
 * cache migration when a room's key changes — reads the old store into a scratch
 * doc so its state can be re-written under the new key. Best-effort: undecryptable
 * or missing data yields an unchanged doc.
 */
export async function loadEncryptedInto(doc: Y.Doc, room: RoomId, cred: RoomCredential): Promise<void> {
  try {
    const key = await deriveCacheKey(cred);
    const db = await openDb(ENC_CACHE_DB_PREFIX + room);
    try {
      for (const rec of await readAll(db)) {
        const plain = await decryptUpdate(key, rec);
        if (plain) Y.applyUpdate(doc, plain);
      }
    } finally {
      db.close();
    }
  } catch {
    /* nothing to migrate */
  }
}

/**
 * Write `doc`'s full state into a room's encrypted cache as a single snapshot,
 * encrypted with `cred` (replacing whatever was there). The write half of a
 * migration to a new key.
 */
export async function writeEncryptedSnapshot(doc: Y.Doc, room: RoomId, cred: RoomCredential): Promise<void> {
  try {
    const key = await deriveCacheKey(cred);
    const db = await openDb(ENC_CACHE_DB_PREFIX + room);
    try {
      await replaceAll(db, await encryptUpdate(key, Y.encodeStateAsUpdate(doc)));
    } finally {
      db.close();
    }
  } catch {
    /* best-effort — a failed cache write must never break a security change */
  }
}
