// Recently-visited rooms — the anti-loss safety net behind the room switcher.
//
// A room's identity is its immutable RoomId; its display name is collaborative
// metadata that can change. This module keeps a small, most-recent-first index
// of the rooms a browser has opened (id + last-known name), so the switcher can
// always offer a way back to a room you've seen — renaming never throws it away.

import type { RoomId, RoomName, RecentRoom } from './types.js';
import { localStore } from '../persistence/local.js';
import { parseRecentRooms } from './parse.js';
import { KEY_RECENT_ROOMS, RECENT_ROOMS_MAX } from './constants.js';

const store = localStore<RecentRoom[]>(
  KEY_RECENT_ROOMS,
  parseRecentRooms,
  (rooms) => JSON.stringify(rooms),
);

/** The remembered rooms, most-recent first. */
export function recentRooms(): RecentRoom[] {
  return store.read();
}

/**
 * Record (or refresh) a visit to a room, moving it to the front. A null `name`
 * preserves any previously-known name rather than wiping it, so a freshly-opened
 * room keeps its label until the shared name (re)loads. Capped at RECENT_ROOMS_MAX.
 */
export function recordRoomVisit(id: RoomId, name: RoomName | null): void {
  const list = store.read();
  const prev = list.find((r) => r.id === id);
  const entry: RecentRoom = { id, name: name ?? prev?.name ?? null, visitedAt: Date.now() };
  const next = [entry, ...list.filter((r) => r.id !== id)].slice(0, RECENT_ROOMS_MAX);
  store.write(next);
}

/** Update the remembered name for a room (no-op if it isn't in the index or is
 *  unchanged). Called when the shared room name loads or is edited. */
export function updateRecentRoomName(id: RoomId, name: RoomName | null): void {
  const list = store.read();
  const i = list.findIndex((r) => r.id === id);
  if (i === -1 || list[i].name === name) return;
  const next = [...list];
  next[i] = { ...next[i], name };
  store.write(next);
}
