import type { RoomId } from './collaboration/types.js';
import type { RoomCredential } from './collaboration/roomAccess.js';
import { parseRoomId, parseRoomCredential } from './collaboration/parse.js';

export type SharedNavigation = { kind: 'room'; room: RoomId; key: RoomCredential | null } | { kind: 'none' };

const URL_IN_TEXT = /https?:\/\/\S+/g;

const SHARE_FIELDS = ['url', 'text', 'title'] as const;

const carriesShare = (params: URLSearchParams): boolean => SHARE_FIELDS.some((f) => params.has(f));

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

/** Web Share Target spec delivers shared content as `title`/`text`/`url` query params. */
export function parseSharedNavigation(search: string): SharedNavigation {
  const params = new URLSearchParams(search);
  if (!carriesShare(params)) return { kind: 'none' };
  for (const field of SHARE_FIELDS) {
    const candidate = params.get(field);
    if (!candidate) continue;
    const link = roomLinkIn(candidate);
    if (link) return { kind: 'room', room: link.room, key: link.key };
  }
  return { kind: 'none' };
}

/** Must run before App.svelte reads `location` at mount. */
export function applySharedNavigation(nav: SharedNavigation): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  if (nav.kind === 'none') {
    const params = new URLSearchParams(location.search);
    if (!carriesShare(params)) return;
    for (const field of SHARE_FIELDS) params.delete(field);
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    return;
  }
  const query = new URLSearchParams();
  query.set('room', nav.room);
  const hash = new URLSearchParams();
  if (nav.key) hash.set('k', nav.key);
  const hashPart = hash.toString() ? `#${hash.toString()}` : '';
  history.replaceState(null, '', `${location.pathname}?${query.toString()}${hashPart}`);
}
