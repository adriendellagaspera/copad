/**
 * The local document library — the rooms this browser has opened, so a document
 * can be found again without having kept its link (docs/contract.md, "Finding a
 * document again"; docs/architecture.md, "The local library").
 */

import type { RoomId, RoomName } from './types.js';
import { SessionRole } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import { parseRoomId, parseRoomName, parseRoomCredential } from './parse.js';
import { localStore } from '../persistence/local.js';
import { KEY_ROOM_HISTORY, ROOM_HISTORY_LIMIT } from './constants.js';
import type { EpochMs, Milliseconds } from '../time.js';

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
 * {@link ROOM_HISTORY_LIMIT} by evicting the least recently opened. A visit
 * never removes what a previous one knew: a keyless visit keeps the remembered
 * key, an unnamed one the remembered name.
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

/** How a remembered visit's time reads in the library list. */
export type OpenedLabel = string & { readonly _brand: 'OpenedLabel' };

const MINUTE_MS = 60_000 as Milliseconds;
const HOUR_MS = (60 * MINUTE_MS) as Milliseconds;
const DAY_MS = (24 * HOUR_MS) as Milliseconds;

/**
 * Recent visits read as elapsed time, older ones as a date: "3h ago" places
 * something opened this morning better than a clock time does, and a date
 * places last month's better than "63d ago" does.
 */
export function openedLabel(at: EpochMs, reference: EpochMs): OpenedLabel {
  const elapsed = (reference - at) as Milliseconds;
  if (elapsed < MINUTE_MS) return 'just now' as OpenedLabel;
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago` as OpenedLabel;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago` as OpenedLabel;
  const date = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return date as OpenedLabel;
}

/** The tail of a room id, telling otherwise identically-named rows apart. */
export type RoomDiscriminator = string & { readonly _brand: 'RoomDiscriminator' };

const DISCRIMINATOR_CHARS = 4;

/** The part of a room id shown beside a name the room shares with others. */
export function roomDiscriminator(room: RoomId): RoomDiscriminator {
  return room.slice(-DISCRIMINATOR_CHARS) as RoomDiscriminator;
}

/** What this browser has done in a room — the evidence a library row rests on. */
export interface RoomEngagement {
  /** Arrived at deliberately: a `?room=` link, `VITE_DEFAULT_ROOM`, or New document. */
  readonly askedFor: boolean;
  readonly writing: boolean;
  readonly accompanied: boolean;
  readonly named: boolean;
  readonly savedHere: boolean;
}

/** Whether a room has earned its row in the library. */
export type LibraryWorthy = boolean & { readonly _brand: 'LibraryWorthy' };

/**
 * A room nobody asked for — minted under a bare visit — waits for a sign of use,
 * so a passer-by who only reads is not handed an "Untitled" row for a document
 * they never wrote in.
 */
export function libraryWorthy(engagement: RoomEngagement): LibraryWorthy {
  const { askedFor, writing, accompanied, named, savedHere } = engagement;
  return (askedFor || writing || accompanied || named || savedHere) as LibraryWorthy;
}

/** The link that reopens a remembered room, key and role included. */
export function roomVisitUrl(visit: RoomVisit, page: PagePath): RoomUrl {
  const params = new URLSearchParams({ room: visit.room });
  if (visit.role === SessionRole.Reader) params.set('role', SessionRole.Reader);
  const key = visit.key ? `#k=${encodeURIComponent(visit.key)}` : '';
  return `${page}?${params.toString()}${key}` as RoomUrl;
}
