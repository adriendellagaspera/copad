import type { RoomId } from './types.js';

/**
 * Mint a fresh room id from a CSPRNG. In `public` access mode the room id is
 * the *only* access control — guessing it reaches the document — so it needs
 * enough entropy that enumeration is infeasible. `crypto.randomUUID()`'s
 * ~122 bits comfortably clears that bar (the old `Math.random()`-derived id
 * carried about 41).
 */
export function newRoomId(): RoomId {
  return crypto.randomUUID() as RoomId;
}
