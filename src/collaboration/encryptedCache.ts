// Hand-rolled over raw IndexedDB because y-indexeddb has no hook to transform
// bytes on the way in or out.

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
const COMPACT_EVERY = 50;

// Tags loads so restoring the cache doesn't echo straight back into it.
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

export function attachEncryptedCache(room: RoomId, doc: Y.Doc, cred: RoomCredential): LocalCache {
  const dbName = ENC_CACHE_DB_PREFIX + room;
  let db: IDBDatabase | undefined;
  let key: CryptoKey | undefined;
  let destroyed = false;
  let ready = false;
  let sinceCompact = 0;
  // Edits arriving before the async init finishes; flushed once ready, never dropped.
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

  // Subscribed synchronously below so no edit is missed while init runs.
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
        Y.transact(doc, () => {
          for (const u of updates) Y.applyUpdate(doc, u, LOAD_ORIGIN);
        }, LOAD_ORIGIN);
      }
      // Unconditional: also drops records written under a previous key and captures
      // edits applied to the doc while this init ran.
      await replaceAll(db, await encryptUpdate(key, Y.encodeStateAsUpdate(doc)));

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
