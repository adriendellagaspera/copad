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
  let ready = false;
  let sinceCompact = 0;
  // Edits that arrive while the async init below is still running — before the DB
  // and key are ready. Buffered rather than dropped, then flushed once ready, so
  // text typed the instant a room unlocks is never lost from the cache.
  const pending: Uint8Array[] = [];

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
  // writes so restoring the cache doesn't echo straight back into it. Subscribed
  // synchronously (below) so no edit is missed; until init finishes, updates are
  // buffered rather than written.
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN) return;
    if (!ready) {
      pending.push(update);
      return;
    }
    void persist(update);
  };
  doc.on('update', onUpdate);

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
      if (destroyed) {
        db.close();
        return;
      }
      if (updates.length) {
        // Apply all restored updates in one transaction, tagged so onUpdate skips them.
        Y.transact(doc, () => {
          for (const u of updates) Y.applyUpdate(doc, u, LOAD_ORIGIN);
        }, LOAD_ORIGIN);
      }
      // Always compact to a single snapshot of the current full state. This bounds
      // on-disk growth, drops any records written under a different key (a key
      // change), AND — for a brand-new cache — captures edits already applied to
      // the doc while this init ran (they'd otherwise never reach the store).
      await replaceAll(db, await encryptUpdate(key, Y.encodeStateAsUpdate(doc)));

      // Flush edits buffered during init that landed after the snapshot's encode.
      // (Those already folded into the snapshot re-apply as harmless idempotent
      // updates — Yjs updates are commutative — until the next compaction.)
      ready = true;
      const buffered = pending.splice(0);
      for (const update of buffered) await persist(update);
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
