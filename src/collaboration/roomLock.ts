// Encrypted-room registry + access-gate logic.
//
// The problem this solves: room encryption is *cooperative* — a wrong or missing
// key just fails to sync silently. So on its own, opening an encrypted room
// without the key is indistinguishable from opening a public one (and, with the
// local cache, the plaintext content even reappears). There is no server to say
// "you're not allowed in".
//
// The fix is to *remember*, per room, a one-way fingerprint of the key the room
// was encrypted with. Given that record we can tell three states apart on the
// next visit — correct key, wrong key, no key — and gate the editor accordingly.
// The fingerprint is a SHA-256 digest (see roomCrypto), never the key itself.

import type { RoomId } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import { localStore } from '../persistence/local.js';
import { roomEncryptedKey } from './constants.js';
import { parseKeyFingerprint } from './parse.js';
import { keyFingerprint, type KeyFingerprint } from './roomCrypto.js';

const fingerprintStore = (room: RoomId) =>
  localStore<KeyFingerprint | null>(
    roomEncryptedKey(room),
    parseKeyFingerprint,
    (fp) => fp ?? null,
  );

/** Record that a room is encrypted with a given credential (stores only the
 *  fingerprint). Idempotent — writing the same key twice is a no-op in effect. */
export async function rememberRoomEncryption(room: RoomId, cred: RoomCredential): Promise<void> {
  fingerprintStore(room).write(await keyFingerprint(cred));
}

/** Forget that a room is encrypted — call when encryption is removed, so a later
 *  visit isn't gated for a room that no longer has a key. */
export function forgetRoomEncryption(room: RoomId): void {
  fingerprintStore(room).clear();
}

/** The fingerprint a room is known to be encrypted with, or null if it isn't
 *  known to be encrypted. Synchronous (a plain registry read). */
export function roomEncryptionFingerprint(room: RoomId): KeyFingerprint | null {
  return fingerprintStore(room).read();
}

/** Why a room is locked. `missing` = known-encrypted but no key supplied;
 *  `wrong` = a key was supplied but it isn't the one the room was encrypted with. */
export type LockReason = 'missing' | 'wrong';

/** Whether a room should be gated, and why. `locked: false` covers both an
 *  unencrypted room and an encrypted room opened with the correct key. */
export interface RoomLockState {
  readonly locked: boolean;
  readonly reason?: LockReason;
}

/**
 * Resolve a room's lock state from its registry entry and the credential
 * currently available. A room with no registry entry is never locked (it isn't
 * known to be encrypted). Async because verifying the key means fingerprinting it.
 */
export async function roomLockState(
  room: RoomId,
  cred: RoomCredential | null,
): Promise<RoomLockState> {
  const stored = roomEncryptionFingerprint(room);
  if (!stored) return { locked: false };
  if (!cred) return { locked: true, reason: 'missing' };
  const fp = await keyFingerprint(cred);
  return fp === stored ? { locked: false } : { locked: true, reason: 'wrong' };
}
