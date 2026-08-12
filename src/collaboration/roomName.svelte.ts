// A module-level holder works because only one Editor is mounted at a time, and
// it must survive a room-switch remount rebinding against the new Y.Doc.

import type { RoomName } from './types.js';

let current = $state<RoomName | null>(null);
let writeThrough: ((name: RoomName | null) => void) | null = null;

export const roomName = {
  get value(): RoomName | null {
    return current;
  },
};

export function bindRoomName(initial: RoomName | null, write: (name: RoomName | null) => void): void {
  current = initial;
  writeThrough = write;
}

export function unbindRoomName(): void {
  writeThrough = null;
  current = null;
}

/** For a change that came from the shared doc: deliberately no write-through. */
export function setRoomNameLocal(name: RoomName | null): void {
  current = name;
}

export function renameRoom(name: RoomName | null): void {
  current = name;
  writeThrough?.(name);
}
