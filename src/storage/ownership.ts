/**
 * Room ownership — which rooms a storage backend is bound to ("owns").
 *
 * Connecting a backend claims the room you're in; because the target file is now
 * scoped per room (see `src/storage/filename.ts`), one backend can own *several*
 * rooms, each holding its own distinct document. In any room a backend does NOT
 * own, the local user is a *guest*: `App.svelte` hands the Editor no `Storage`, so
 * that room keeps its own document — it is neither loaded from nor saved to the
 * backend. This is why an imported document no longer follows you when you switch
 * rooms, and it is the source of truth for the owner/guest indicator in the header.
 *
 * Persisted per backend under `storage.<id>.rooms` (a JSON array) so ownership —
 * including of several rooms — survives a reload and is restored on re-login.
 */

import type { StorageId } from './types.js';
import type { RoomId } from '../collaboration/types.js';
import { parseRoomList } from '../collaboration/parse.js';
import { localStore } from '../persistence/local.js';
import { backendKey } from './constants.js';

/** Read/write the set of rooms a storage backend owns. */
export interface OwnershipStore {
  /** Whether this backend owns `room`. */
  owns(room: RoomId): boolean;
  /** Add `room` to this backend's owned set (idempotent). */
  claim(room: RoomId): void;
  /** Remove `room` from this backend's owned set. */
  release(room: RoomId): void;
  /** Every room this backend owns. */
  rooms(): RoomId[];
}

/** Persisted owned-room set for a single storage backend. */
export function ownershipStore(backendId: StorageId): OwnershipStore {
  const store = localStore<RoomId[]>(
    backendKey(backendId, 'rooms'),
    parseRoomList,
    (rooms) => (rooms.length ? JSON.stringify(rooms) : null),
  );
  return {
    owns: (room) => store.read().includes(room),
    claim: (room) => {
      const rooms = store.read();
      if (!rooms.includes(room)) store.write([...rooms, room]);
    },
    release: (room) => store.write(store.read().filter((r) => r !== room)),
    rooms: () => store.read(),
  };
}
