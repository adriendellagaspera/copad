import type { StorageId, Filename } from './types.js';
import type { RoomId } from '../collaboration/types.js';
import { parseFilename } from './parse.js';
import { extensionOf } from '../format/types.js';
import { localStore, storageKey } from '../persistence/local.js';
import { DEFAULT_FILENAME } from './constants.js';

/** Read/write access to the persisted target filename for one storage backend. */
export interface FilenameStore {
  get(): Filename;
  set(name: string): void;
}

/** localStorage key for a backend's target filename in one room. */
function perRoomFilenameKey(backendId: StorageId, room: RoomId) {
  return storageKey(`storage.${backendId}.filename.${room}`);
}

/** A filesystem-safe stem cut from a room id (drop anything but `[A-Za-z0-9._-]`). */
function roomStem(room: RoomId): string {
  return room.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
}

/**
 * The default target filename for a room: a distinct file derived from the room
 * id, keeping the backend default's *extension* (which selects the codec/format),
 * so two rooms on one backend never collide on the same path.
 */
function roomDefaultFilename(room: RoomId, fallback: Filename): Filename {
  return `${roomStem(room)}${extensionOf(fallback)}` as Filename;
}

/**
 * Persisted target filename for a storage backend, scoped **per room**. The
 * extension drives which codec (see src/format) reads/writes the document, so
 * this is how a user picks a format — `notes.md`, `document.html`, … — for the
 * room they're in.
 *
 * `room` is captured once, by closure — a tab is in exactly one room for its
 * whole lifetime (there is no in-tab room switch), so the store never needs to
 * re-target after construction.
 *
 * Stored per backend *and room* under `storage.<id>.filename.<room>`. localStorage
 * and parsing stay behind the store — this module only reads/writes typed Filenames.
 */
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

/** The target filename a backend uses for a *specific* room (without switching
 *  the active room). Used to detect when two rooms resolve to the same file. */
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

/**
 * The first room in `files` (other than `current`) that resolves to the *same*
 * filename as `current` — i.e. a room that would write to the same physical file
 * on this backend, silently overwriting the other. `null` when there's no clash.
 * Pure, so it's unit-testable; the caller supplies each owned room's filename.
 */
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
