import type { RoomId } from './types.js';
import type { RoomAccess, RoomCredential } from './roomAccess.js';
import { RoomAccessMode } from './roomAccess.js';
import type { RoomCipher } from './roomCipher.js';
import { parseRoomCredential } from './parse.js';

/**
 * Dual-port type: `secretLink()` satisfies both {@link RoomAccess} and
 * {@link RoomCipher} because the URL-fragment key is simultaneously the
 * access gate (you need the link) and the y-webrtc encryption key.
 */
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

/**
 * A randomly generated key embedded in the URL `#k=` fragment.
 *
 * - First visitor: a new UUID is generated and written into the URL hash.
 *   Sharing the full URL (including `#k=`) grants both access and decryption.
 * - Returning visitor or tab reload: the existing key is read from the hash
 *   — no new key is generated, so the existing encrypted room keeps working.
 * - The hash fragment is client-side only; the signaling server never sees it.
 */
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

/** The key currently in the URL `#k=` fragment, or `null` — *without* generating
 *  one (unlike {@link secretLink}). For UI that inspects the current state. */
export function currentSecretKey(): RoomCredential | null {
  return parseKey();
}
