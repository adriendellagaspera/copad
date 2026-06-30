// Shared reactive bridge for the current room's editable name.
//
// The name is collaborative state living in the shared Y.Doc, which is owned by
// the Editor — but it is edited in the header, which lives in App. This module
// is the bridge: a single reactive holder both sides read, plus a write-through
// the Editor installs so a header edit reaches the Y.Doc.
//
//   Editor (mount)  → bindRoomName(initial, write)   installs the Y.Doc writer
//   Editor (remote) → setRoomNameLocal(name)         mirrors a synced change in
//   App   (header)  → renameRoom(name)               local edit, written through
//   App/UI (read)   → roomName.value                 reactive current value
//
// Only one Editor is mounted at a time ({#key room} remounts it), so a single
// module-level holder is sufficient; the Editor unbinds on teardown.

import type { RoomName } from './types.js';

let current = $state<RoomName | null>(null);
let writeThrough: ((name: RoomName | null) => void) | null = null;

/** Reactive accessor for the current room name (null → show the room id). */
export const roomName = {
  get value(): RoomName | null {
    return current;
  },
};

/** Install the Y.Doc write-through and seed the initial value (Editor mount). */
export function bindRoomName(initial: RoomName | null, write: (name: RoomName | null) => void): void {
  current = initial;
  writeThrough = write;
}

/** Drop the write-through and clear the value (Editor teardown / room change). */
export function unbindRoomName(): void {
  writeThrough = null;
  current = null;
}

/** Mirror a value that changed in the shared doc (initial sync or a remote edit). */
export function setRoomNameLocal(name: RoomName | null): void {
  current = name;
}

/** Apply a local edit: update the reactive value and push it into the shared doc. */
export function renameRoom(name: RoomName | null): void {
  current = name;
  writeThrough?.(name);
}
