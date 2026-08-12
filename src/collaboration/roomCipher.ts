import type { RoomId } from './types.js';
import type { RoomCredential } from './roomAccess.js';

/** WebRTC only: the hub transport relays plaintext by construction. */
export interface RoomCipher {
  password(room: RoomId): RoomCredential | null;
}

export function plaintext(): RoomCipher {
  return { password: () => null };
}
