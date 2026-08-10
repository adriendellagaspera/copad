/**
 * Which surface the page URL asks for, and the URLs that reach each one.
 *
 * The explanation is a query flag (`?about`), never a path: the app ships as a
 * static bundle to hosts that serve no SPA fallback, where `/about` would 404.
 */

import type { RoomId } from '../collaboration/types.js';
import type { RoomCredential } from '../collaboration/roomAccess.js';
import type { PagePath } from '../collaboration/roomHistory.js';

/** `location.search`, cast once where `location` is read. */
export type PageQuery = string & { readonly _brand: 'PageQuery' };

/** A URL this app navigates itself to: path, query and fragment. */
export type RouteUrl = string & { readonly _brand: 'RouteUrl' };

export const RouteKind = { Room: 'room', About: 'about' } as const;
export type RouteKind = (typeof RouteKind)[keyof typeof RouteKind];

export type Route =
  | { readonly kind: typeof RouteKind.Room }
  | { readonly kind: typeof RouteKind.About };

const ABOUT_PARAM = 'about';

export function routeFor(query: PageQuery): Route {
  return new URLSearchParams(query).has(ABOUT_PARAM)
    ? { kind: RouteKind.About }
    : { kind: RouteKind.Room };
}

export function aboutUrl(page: PagePath): RouteUrl {
  return `${page}?${ABOUT_PARAM}=` as RouteUrl;
}

/** A fresh room, opened with the title focused and encrypted by its `#k=` key. */
export function newDocumentUrl(page: PagePath, room: RoomId, key: RoomCredential): RouteUrl {
  return `${page}?room=${encodeURIComponent(room)}&new=1#k=${encodeURIComponent(key)}` as RouteUrl;
}
