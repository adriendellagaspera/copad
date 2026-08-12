import type { RoomId } from './types.js';
import type { RoomAccess, RoomCredential } from './roomAccess.js';
import { RoomAccessMode } from './roomAccess.js';
import type { RoomCipher } from './roomCipher.js';
import { parseRoomCredential } from './parse.js';

/** Dual port: the fragment key is both the access gate and the cipher key. */
export type SecretLinkPort = RoomAccess & RoomCipher;

const FRAGMENT_KEY = 'k';

function parseKey(): RoomCredential | null {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(location.hash.slice(1));
  return parseRoomCredential(params.get(FRAGMENT_KEY));
}

function writeKey(key: RoomCredential): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const params = new URLSearchParams(location.hash.slice(1));
  params.set(FRAGMENT_KEY, key);
  history.replaceState(null, '', '#' + params.toString());
}

export function mintSecretKey(): RoomCredential {
  return crypto.randomUUID() as RoomCredential;
}

/** Mints only when the hash carries no key: a fresh one would orphan the room. */
export function secretLink(): SecretLinkPort {
  const existing = parseKey();
  const key: RoomCredential = existing ?? mintSecretKey();
  if (!existing) writeKey(key);
  return {
    mode: RoomAccessMode.SecretLink,
    credential: (_room: RoomId) => key,
    password: (_room: RoomId) => key,
  };
}

/** Never mints, unlike {@link secretLink}. */
export function currentSecretKey(): RoomCredential | null {
  return parseKey();
}
