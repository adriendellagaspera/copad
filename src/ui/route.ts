// `?about` is a query flag, not a path: static hosts serve no SPA fallback, so `/about` would 404.

import type { RoomId } from '../collaboration/types.js';
import type { RoomCredential } from '../collaboration/roomAccess.js';
import type { PagePath } from '../collaboration/roomHistory.js';

export type PageQuery = string & { readonly _brand: 'PageQuery' };

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

export function newDocumentUrl(page: PagePath, room: RoomId, key: RoomCredential): RouteUrl {
  return `${page}?room=${encodeURIComponent(room)}&new=1#k=${encodeURIComponent(key)}` as RouteUrl;
}
