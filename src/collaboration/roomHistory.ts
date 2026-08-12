// See docs/contract.md §7, "Finding a document again".

import type { RoomId, RoomName } from './types.js';
import { SessionRole } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import { parseRoomId, parseRoomName, parseRoomCredential } from './parse.js';
import { localStore } from '../persistence/local.js';
import { KEY_ROOM_HISTORY, ROOM_HISTORY_LIMIT } from './constants.js';
import type { EpochMs, Milliseconds } from '../time.js';

export interface RoomVisit {
  readonly room: RoomId;
  readonly name: RoomName | null;
  readonly key: RoomCredential | null;
  readonly role: SessionRole;
  readonly openedAt: EpochMs;
}

/** The way back is derived from the current page path, never a stored URL. */
export type PagePath = string & { readonly _brand: 'PagePath' };

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

/** A visit never removes what a previous one knew (key, name). */
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

export function roomHistory(): RoomVisit[] {
  return store.read();
}

export function rememberRoomVisit(visit: RoomVisit): void {
  store.write(withVisit(store.read(), visit));
}

export function forgetRoom(room: RoomId): void {
  store.write(store.read().filter((v) => v.room !== room));
}

export function clearRoomHistory(): void {
  store.clear();
}

export type OpenedLabel = string & { readonly _brand: 'OpenedLabel' };

const MINUTE_MS = 60_000 as Milliseconds;
const HOUR_MS = (60 * MINUTE_MS) as Milliseconds;
const DAY_MS = (24 * HOUR_MS) as Milliseconds;

export function openedLabel(at: EpochMs, reference: EpochMs): OpenedLabel {
  const elapsed = (reference - at) as Milliseconds;
  if (elapsed < MINUTE_MS) return 'just now' as OpenedLabel;
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago` as OpenedLabel;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago` as OpenedLabel;
  const date = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return date as OpenedLabel;
}

export type RoomDiscriminator = string & { readonly _brand: 'RoomDiscriminator' };

const DISCRIMINATOR_CHARS = 4;

export function roomDiscriminator(room: RoomId): RoomDiscriminator {
  return room.slice(-DISCRIMINATOR_CHARS) as RoomDiscriminator;
}

export interface RoomEngagement {
  /** Arrived at deliberately: a `?room=` link, `VITE_DEFAULT_ROOM`, or New document. */
  readonly askedFor: boolean;
  readonly writing: boolean;
  readonly accompanied: boolean;
  readonly named: boolean;
  readonly savedHere: boolean;
}

export type LibraryWorthy = boolean & { readonly _brand: 'LibraryWorthy' };

/** A room nobody asked for waits for a sign of use before earning a row. */
export function libraryWorthy(engagement: RoomEngagement): LibraryWorthy {
  const { askedFor, writing, accompanied, named, savedHere } = engagement;
  return (askedFor || writing || accompanied || named || savedHere) as LibraryWorthy;
}

export function roomVisitUrl(visit: RoomVisit, page: PagePath): RoomUrl {
  const params = new URLSearchParams({ room: visit.room });
  if (visit.role === SessionRole.Reader) params.set('role', SessionRole.Reader);
  const key = visit.key ? `#k=${encodeURIComponent(visit.key)}` : '';
  return `${page}?${params.toString()}${key}` as RoomUrl;
}
