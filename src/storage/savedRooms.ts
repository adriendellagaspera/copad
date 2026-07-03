/**
 * Saved rooms — the set of rooms a storage backend saves for the local user.
 *
 * Connecting a backend marks the room you're in as saved here; because the target
 * file is scoped per room (see `src/storage/filename.ts`), one backend can save
 * *several* rooms, each holding its own distinct document. A room a backend does
 * NOT save is **live-only** for you: `App.svelte` hands the Editor no `Storage`, so
 * that room keeps its own document — it is neither loaded from nor saved to the
 * backend. This is why an imported document no longer follows you when you switch
 * rooms, and it is the source of truth for the Saved / Live-only header indicator.
 *
 * It's a per-user fact, not a room-level role: with per-target autosave several
 * people can each save the same room to their own backend independently.
 *
 * Persisted per backend under `storage.<id>.rooms` (a JSON array) so the set —
 * including of several rooms — survives a reload and is restored on re-login.
 */

import type { StorageId } from './types.js';
import type { RoomId } from '../collaboration/types.js';
import { parseRoomList } from '../collaboration/parse.js';
import { localStore } from '../persistence/local.js';
import { backendKey } from './constants.js';

/** Read/write the set of rooms a storage backend saves for the local user. */
export interface SavedRooms {
  /** Whether this backend saves `room`. */
  saves(room: RoomId): boolean;
  /** Mark `room` as saved by this backend (idempotent). */
  add(room: RoomId): void;
  /** Stop saving `room` with this backend. */
  remove(room: RoomId): void;
  /** Every room this backend saves. */
  all(): RoomId[];
}

/** Persisted saved-room set for a single storage backend. */
export function savedRoomsStore(backendId: StorageId): SavedRooms {
  const store = localStore<RoomId[]>(
    backendKey(backendId, 'rooms'),
    parseRoomList,
    (rooms) => (rooms.length ? JSON.stringify(rooms) : null),
  );
  return {
    saves: (room) => store.read().includes(room),
    add: (room) => {
      const rooms = store.read();
      if (!rooms.includes(room)) store.write([...rooms, room]);
    },
    remove: (room) => store.write(store.read().filter((r) => r !== room)),
    all: () => store.read(),
  };
}
