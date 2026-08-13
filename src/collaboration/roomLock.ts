// Room encryption is cooperative: a wrong or missing key only fails to sync,
// silently. The stored fingerprint is what makes those cases distinguishable.

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

export async function rememberRoomEncryption(room: RoomId, cred: RoomCredential): Promise<void> {
  fingerprintStore(room).write(await keyFingerprint(cred));
}

export function forgetRoomEncryption(room: RoomId): void {
  fingerprintStore(room).clear();
}

export function roomEncryptionFingerprint(room: RoomId): KeyFingerprint | null {
  return fingerprintStore(room).read();
}

export type LockReason = 'missing' | 'wrong';

export interface RoomLockState {
  readonly locked: boolean;
  readonly reason?: LockReason;
}

/** No registry entry means the room isn't known to be encrypted: never locked. */
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
