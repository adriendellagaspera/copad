// Semantics: docs/architecture.md, "Saved rooms (per-user persistence)".

import type { StorageId } from './types.js';
import type { RoomId } from '../collaboration/types.js';
import { parseRoomList } from '../collaboration/parse.js';
import { localStore } from '../persistence/local.js';
import { backendKey } from './constants.js';

export interface SavedRooms {
  saves(room: RoomId): boolean;
  add(room: RoomId): void;
  remove(room: RoomId): void;
  all(): RoomId[];
}

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
