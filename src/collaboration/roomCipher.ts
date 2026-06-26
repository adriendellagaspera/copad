import type { RoomId } from './types.js';

/**
 * The cryptographic contract for a room: given the room id, return the string
 * y-webrtc should use as its AES password, or `null` for no encryption.
 *
 * Implementations close over their key material at construction time
 * ({@link plaintext}) or delegate to a {@link RoomAccess} object that resolves
 * the credential per room ({@link passwordCipher}). The {@link secretLink}
 * adapter in `secretLink.ts` implements both this port and `RoomAccess`
 * because the URL-embedded key is simultaneously the access gate and the
 * cipher key.
 *
 * Applies to the WebRTC transport only — the WebSocket hub relays plaintext
 * by design (the server is always in the data path).
 */
export interface RoomCipher {
  password(room: RoomId): string | null;
}

/** No encryption — the room is transmitted in plaintext. */
export function plaintext(): RoomCipher {
  return { password: () => null };
}
