import type { StorageId, Filename } from './types.js';
import type { RoomId } from '../collaboration/types.js';
import { parseFilename } from './parse.js';
import { extensionOf } from '../format/types.js';
import { localStore, storageKey } from '../persistence/local.js';
import { DEFAULT_FILENAME } from './constants.js';

export interface FilenameStore {
  get(): Filename;
  set(name: string): void;
}

function perRoomFilenameKey(backendId: StorageId, room: RoomId) {
  return storageKey(`storage.${backendId}.filename.${room}`);
}

function roomStem(room: RoomId): string {
  return room.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
}

function roomDefaultFilename(room: RoomId, fallback: Filename): Filename {
  return `${roomStem(room)}${extensionOf(fallback)}` as Filename;
}

// `room` is captured once by closure: a tab never switches rooms.
export function filenameStore(
  backendId: StorageId,
  room: RoomId,
  fallback: Filename = DEFAULT_FILENAME,
): FilenameStore {
  const store = localStore<Filename>(
    perRoomFilenameKey(backendId, room),
    (raw) => parseFilename(raw, roomDefaultFilename(room, fallback)),
    (name) => name.trim() || null,
  );

  return {
    get: () => store.read(),
    set: (name) => store.write(name.trim() as Filename),
  };
}

export function filenameForRoom(
  backendId: StorageId,
  room: RoomId,
  fallback: Filename = DEFAULT_FILENAME,
): Filename {
  return localStore<Filename>(
    perRoomFilenameKey(backendId, room),
    (raw) => parseFilename(raw, roomDefaultFilename(room, fallback)),
    (name) => name.trim() || null,
  ).read();
}

export function firstFileCollision(
  current: RoomId,
  files: ReadonlyMap<RoomId, Filename>,
): RoomId | null {
  const mine = files.get(current);
  if (!mine) return null;
  for (const [room, name] of files) {
    if (room !== current && name === mine) return room;
  }
  return null;
}
