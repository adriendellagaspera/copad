import type { StorageId, Filename } from './types.js';
import type { RoomId } from '../collaboration/types.js';
import { parseFilename } from './parse.js';
import { extensionOf } from '../format/types.js';
import { localStore, storageKey } from '../persistence/local.js';
import { DEFAULT_FILENAME, backendKey } from './constants.js';

/** Read/write access to the persisted target filename for one storage backend. */
export interface FilenameStore {
  get(): Filename;
  set(name: string): void;
}

// ── Active room (app-global) ─────────────────────────────────────────────────
// A backend targets exactly one file at a time, but that file now depends on the
// room you're in, so one backend can hold a *distinct* document per room instead
// of every room sharing a single file. Exactly one room is active at a time, so
// the active room (and the home/default room, which keeps the legacy default
// filename for backward compatibility) live here as app-global state that every
// filenameStore reads. `App.svelte` sets both on startup and on each room switch,
// synchronously — before the Editor remounts and reads `filename()`.

let activeRoom: RoomId | null = null;
let defaultRoom: RoomId | null = null;

/** Set the room whose document every backend currently targets. */
export function setActiveRoom(room: RoomId): void {
  activeRoom = room;
}

/** Set the home/default room — the one that keeps the plain default filename
 *  (e.g. `document.yjs`) so existing single-document setups keep working. */
export function setDefaultRoom(room: RoomId): void {
  defaultRoom = room;
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
 * The default target filename for a room: the home room keeps the backend's plain
 * default (back-compat), every other room derives a distinct file from its id
 * while preserving the default's *extension* (which selects the codec/format), so
 * two rooms on one backend never collide on the same path.
 */
function roomDefaultFilename(room: RoomId, fallback: Filename): Filename {
  // Home room — or rooms not configured yet (non-App contexts) — keep the plain
  // default; every other room derives a distinct file.
  if (!defaultRoom || room === defaultRoom) return fallback;
  return `${roomStem(room)}${extensionOf(fallback)}` as Filename;
}

/**
 * Persisted target filename for a storage backend, scoped **per room**. The
 * extension drives which codec (see src/format) reads/writes the document, so
 * this is how a user picks a format — `notes.md`, `document.html`, … — for the
 * room they're in.
 *
 * Stored per backend *and room* under `storage.<id>.filename.<room>`. A pre-
 * existing global `storage.<id>.filename` (the old room-agnostic key) is migrated
 * once onto the home room, so a customised filename isn't lost on upgrade.
 * localStorage and parsing stay behind the store — this module only reads/writes
 * typed Filenames.
 */
export function filenameStore(backendId: StorageId, fallback: Filename = DEFAULT_FILENAME): FilenameStore {
  // The old room-agnostic key. Read as Filename | null so a genuinely-set custom
  // filename can be told apart from "never set" (which the parser would default).
  const legacy = localStore<Filename | null>(
    backendKey(backendId, 'filename'),
    (raw) => {
      const t = (raw ?? '').trim();
      return t ? (t as Filename) : null;
    },
    (name) => name,
  );

  const perRoom = (room: RoomId) =>
    localStore<Filename>(
      perRoomFilenameKey(backendId, room),
      (raw) => parseFilename(raw, roomDefaultFilename(room, fallback)),
      (name) => name.trim() || null,
    );

  const currentRoom = (): RoomId => activeRoom ?? defaultRoom ?? ('document' as RoomId);

  // One-time upgrade: fold a customised global filename onto the home room, then
  // drop the legacy key so this runs at most once per backend.
  const migrateLegacy = (): void => {
    if (!defaultRoom) return;
    const custom = legacy.read();
    if (custom === null) return;
    perRoom(defaultRoom).write(custom);
    legacy.clear();
  };

  return {
    get() {
      migrateLegacy();
      return perRoom(currentRoom()).read();
    },
    set(name) {
      perRoom(currentRoom()).write(name.trim() as Filename);
    },
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
