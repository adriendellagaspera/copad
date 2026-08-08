import type { RoomId } from './collaboration/types.js';
import type { RoomCredential } from './collaboration/roomAccess.js';
import { parseRoomId, parseRoomCredential } from './collaboration/parse.js';

export type SharedNavigation = { kind: 'room'; room: RoomId; key: RoomCredential | null } | { kind: 'none' };

const URL_IN_TEXT = /https?:\/\/\S+/g;

function roomLinkIn(candidate: string): { room: RoomId; key: RoomCredential | null } | null {
  const matches = candidate.match(URL_IN_TEXT);
  if (!matches) return null;
  for (const match of matches) {
    let url: URL;
    try {
      url = new URL(match);
    } catch {
      continue;
    }
    const room = parseRoomId(url.searchParams.get('room'));
    if (!room) continue;
    const key = parseRoomCredential(new URLSearchParams(url.hash.slice(1)).get('k'));
    return { room, key };
  }
  return null;
}

/**
 * Interpret the query params the manifest's `share_target` GET action delivers
 * (`title`/`text`/`url`, per the Web Share Target spec) into a room to open. A
 * shared Copad link resolves to that room; anything else — a WhatsApp contact,
 * arbitrary text, a foreign link — resolves to `none`, which App.svelte's own
 * `roomFromUrl()` already treats as "no room param" and opens the default room.
 */
export function parseSharedNavigation(search: string): SharedNavigation {
  const params = new URLSearchParams(search);
  if (!params.has('url') && !params.has('text') && !params.has('title')) return { kind: 'none' };
  for (const field of ['url', 'text', 'title']) {
    const candidate = params.get(field);
    if (!candidate) continue;
    const link = roomLinkIn(candidate);
    if (link) return { kind: 'room', room: link.room, key: link.key };
  }
  return { kind: 'none' };
}

/** Rewrites the current URL from share-target params to Copad's own `?room=…#k=…`
 *  shape (or strips them entirely for the default-room fallback) before App.svelte
 *  reads `location` at mount. */
export function applySharedNavigation(nav: SharedNavigation): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  if (nav.kind === 'none') {
    const params = new URLSearchParams(location.search);
    if (!params.has('url') && !params.has('text') && !params.has('title')) return;
    history.replaceState(null, '', location.pathname);
    return;
  }
  const query = new URLSearchParams();
  query.set('room', nav.room);
  const hash = new URLSearchParams();
  if (nav.key) hash.set('k', nav.key);
  const hashPart = hash.toString() ? `#${hash.toString()}` : '';
  history.replaceState(null, '', `${location.pathname}?${query.toString()}${hashPart}`);
}
