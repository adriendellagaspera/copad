// Per-room end-to-end encryption key resolution for the WebRTC transport.
//
// y-webrtc encrypts a room's traffic from a `password`. Copad supports two ways
// to set one per room, the user's choice:
//   1. Secret in the share link — a random key carried in the URL *hash* (#k=…).
//      The hash is never sent to the signaling server, so the key stays between
//      the people who hold the link.
//   2. Manual password — typed by the user, remembered locally per room, shared
//      out-of-band. The link does not contain it.
// A deployment-wide VITE_ROOM_PASSWORD remains a fallback for backward compat.
//
// Precedence: link hash key → remembered per-room password → env password → none.

import type { RoomId } from './types.js';

const PW_PREFIX = 'copad:roompw:';

/** The encryption key carried in the URL hash (#k=…), if any. */
export function getLinkKey(loc: { hash: string }): string | undefined {
  const h = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash;
  const k = new URLSearchParams(h).get('k');
  return k || undefined;
}

/** A manually-set, locally-remembered password for a room. */
export function rememberedRoomPassword(room: RoomId): string | undefined {
  try {
    return localStorage.getItem(PW_PREFIX + room) || undefined;
  } catch {
    return undefined;
  }
}

export function setRoomPassword(room: RoomId, pw: string | null): void {
  try {
    if (pw) localStorage.setItem(PW_PREFIX + room, pw);
    else localStorage.removeItem(PW_PREFIX + room);
  } catch {
    /* ignore */
  }
}

/** Resolve the effective room password (see precedence note at the top). */
export function resolveRoomPassword(
  room: RoomId,
  loc: { hash: string },
  envPassword?: string,
): string | undefined {
  return getLinkKey(loc) ?? rememberedRoomPassword(room) ?? (envPassword || undefined);
}

export function roomIsEncrypted(
  room: RoomId,
  loc: { hash: string },
  envPassword?: string,
): boolean {
  return resolveRoomPassword(room, loc, envPassword) !== undefined;
}

/** Generate a random URL-safe room key (128 bits, hex). */
export function generateRoomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Write (or clear) the URL hash key in place — no navigation/reload. */
export function setLinkKey(
  key: string | null,
  loc: { pathname: string; search: string },
  hist: History,
): void {
  const base = loc.pathname + loc.search;
  hist.replaceState(null, '', key ? `${base}#k=${encodeURIComponent(key)}` : base);
}

/** Build the shareable URL for a room, including the hash key when present. */
export function roomShareUrl(
  room: RoomId,
  loc: { origin: string; pathname: string; hash: string },
): string {
  const base = `${loc.origin}${loc.pathname}?room=${encodeURIComponent(room)}`;
  const k = getLinkKey(loc);
  return k ? `${base}#k=${encodeURIComponent(k)}` : base;
}
