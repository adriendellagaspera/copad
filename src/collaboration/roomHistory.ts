/**
 * The local document library — the rooms this browser has opened.
 *
 * A room has no server-side existence: without its URL there is no way back to
 * it. This is the browser's own index of the rooms it has been in, so a document
 * can be found again without keeping a link. It is deliberately *local*: it
 * records where this browser has been, never who owns what.
 *
 * Each entry carries the room's encryption key when one is in effect. Dropping
 * it would produce an entry that reopens an undecryptable room, so the key is
 * kept — the same exposure the per-room password store (`collab.room-password.*`)
 * already accepts, and the reason a keyed entry survives a visit that has no key.
 *
 * The link back is *derived* (`roomVisitUrl`) from the current page path rather
 * than stored, so a hand-edited store can never put an arbitrary URL behind a
 * link, and a deployment that moves origin or path keeps its library working.
 */

import type { RoomId, RoomName } from './types.js';
import { SessionRole } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import { parseRoomId, parseRoomName, parseRoomCredential } from './parse.js';
import { localStore } from '../persistence/local.js';
import { KEY_ROOM_HISTORY, ROOM_HISTORY_LIMIT } from './constants.js';
import type { EpochMs } from '../time.js';

/** One room this browser has opened, as the library remembers it. */
export interface RoomVisit {
  readonly room: RoomId;
  readonly name: RoomName | null;
  /** The room's key (`#k=`) when it has one — without it the entry can't decrypt. */
  readonly key: RoomCredential | null;
  readonly role: SessionRole;
  readonly openedAt: EpochMs;
}

/** Path of the page serving the app, e.g. `/` — what a remembered room reopens against. */
export type PagePath = string & { readonly _brand: 'PagePath' };

/** A link back into a remembered room, built from a {@link PagePath}. */
export type RoomUrl = string & { readonly _brand: 'RoomUrl' };

function parseVisit(raw: unknown): RoomVisit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const room = parseRoomId(typeof o['room'] === 'string' ? o['room'] : null);
  if (!room) return null;
  const openedAtRaw = o['openedAt'];
  const openedAt = (Number.isFinite(openedAtRaw) ? (openedAtRaw as number) : 0) as EpochMs;
  return {
    room,
    name: parseRoomName(typeof o['name'] === 'string' ? o['name'] : null),
    key: parseRoomCredential(typeof o['key'] === 'string' ? o['key'] : null),
    role: o['role'] === SessionRole.Reader ? SessionRole.Reader : SessionRole.Writer,
    openedAt,
  };
}

/** Parse the stored library — malformed entries are dropped, never thrown on. */
export function parseRoomHistory(raw: string | null): RoomVisit[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const parsed = list
      .map(parseVisit)
      .filter((v): v is RoomVisit => v !== null)
      .sort((a, b) => b.openedAt - a.openedAt);
    const byRoom = new Map<RoomId, RoomVisit>();
    for (const visit of parsed) if (!byRoom.has(visit.room)) byRoom.set(visit.room, visit);
    return [...byRoom.values()].slice(0, ROOM_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function serializeRoomHistory(visits: RoomVisit[]): string | null {
  return visits.length ? JSON.stringify(visits) : null;
}

const store = localStore<RoomVisit[]>(KEY_ROOM_HISTORY, parseRoomHistory, serializeRoomHistory);

/**
 * Fold a visit into the library, most recent first, capped at
 * {@link ROOM_HISTORY_LIMIT} by evicting the least recently opened.
 *
 * A visit never *removes* what a previous one knew: a room opened from a link
 * with no key keeps the key it was remembered with, and a room whose name hasn't
 * synced yet keeps the name last seen. Both would otherwise be silent losses.
 */
export function withVisit(history: RoomVisit[], visit: RoomVisit): RoomVisit[] {
  const previous = history.find((v) => v.room === visit.room);
  const merged: RoomVisit = {
    room: visit.room,
    name: visit.name ?? previous?.name ?? null,
    key: visit.key ?? previous?.key ?? null,
    role: visit.role,
    openedAt: visit.openedAt,
  };
  return [merged, ...history.filter((v) => v.room !== visit.room)].slice(0, ROOM_HISTORY_LIMIT);
}

/** Every room this browser has opened, most recently opened first. */
export function roomHistory(): RoomVisit[] {
  return store.read();
}

/** Record (or refresh) a room in the library. */
export function rememberRoomVisit(visit: RoomVisit): void {
  store.write(withVisit(store.read(), visit));
}

/** Drop one room from the library. */
export function forgetRoom(room: RoomId): void {
  store.write(store.read().filter((v) => v.room !== room));
}

/** Drop the whole library — the rooms themselves are untouched. */
export function clearRoomHistory(): void {
  store.clear();
}

/** The link that reopens a remembered room, key and role included. */
export function roomVisitUrl(visit: RoomVisit, page: PagePath): RoomUrl {
  const params = new URLSearchParams({ room: visit.room });
  if (visit.role === SessionRole.Reader) params.set('role', SessionRole.Reader);
  const key = visit.key ? `#k=${encodeURIComponent(visit.key)}` : '';
  return `${page}?${params.toString()}${key}` as RoomUrl;
}
