import type { RoomId } from './types.js';

// CSPRNG, not Math.random — in `public` mode the room id is the only access control.
export function newRoomId(): RoomId {
  return crypto.randomUUID() as RoomId;
}
