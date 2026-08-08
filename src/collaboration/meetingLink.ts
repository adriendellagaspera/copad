import type { RoomId } from './types.js';
import type { RoomCredential } from './roomAccess.js';

/** Redirect wrappers that must be unwrapped before fingerprinting, or the same
 *  meeting link forwarded through different mail clients derives different rooms. */
const LINK_WRAPPERS: readonly ((url: URL) => string | null)[] = [
  (url) => (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(url.hostname) ? url.searchParams.get('url') : null),
];

/** Query params that vary by how a link was shared, not by which meeting it
 *  points to — dropped so two shares of the same meeting fingerprint identically.
 *  Zoom's `pwd=` is deliberately NOT here: it's part of the meeting's identity. */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'authuser', 'usp', 'ref', 'fbclid', 'gclid', 'si',
]);

const MAX_WRAP_DEPTH = 3;

function unwrap(raw: string): URL | null {
  let current = raw.trim();
  for (let i = 0; i < MAX_WRAP_DEPTH; i++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return null;
    }
    const inner = LINK_WRAPPERS.reduce<string | null>((found, unwrapOne) => found ?? unwrapOne(url), null);
    if (!inner) return url;
    current = inner;
  }
  return null;
}

/**
 * Two URLs for the same meeting must fingerprint identically, or pasting the
 * "same" link from different sources silently derives two different rooms
 * (contract §6.2's whole premise). Unwraps known redirect wrappers, lowercases
 * only the host (meeting tokens in the path/query are often case-sensitive),
 * drops share-tracking params, and sorts what's left.
 */
export function meetingLinkFingerprint(raw: string): string | null {
  const url = unwrap(raw);
  if (!url) return null;

  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  params.sort();

  const path = url.pathname.replace(/\/+$/, '') || '/';
  const query = params.toString();
  return `https://${url.hostname.toLowerCase()}${path}${query ? `?${query}` : ''}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Version-prefixed so a future scheme change never silently splits an existing pad.
const ROOM_PREFIX = 'copad-meet-room-v1:';
const KEY_PREFIX = 'copad-meet-key-v1:';

/**
 * Derives a room + encryption key from a meeting link, entirely client-side —
 * anyone who pastes the same link lands in the same encrypted pad, with no
 * Copad link ever shared first (contract §6.2). `null` when `raw` isn't a URL.
 */
export async function deriveMeetingRoom(raw: string): Promise<{ room: RoomId; key: RoomCredential } | null> {
  const fingerprint = meetingLinkFingerprint(raw);
  if (!fingerprint) return null;
  const [room, key] = await Promise.all([
    sha256Hex(ROOM_PREFIX + fingerprint),
    sha256Hex(KEY_PREFIX + fingerprint),
  ]);
  return { room: room as RoomId, key: key as RoomCredential };
}
