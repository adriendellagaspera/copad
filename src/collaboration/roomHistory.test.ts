import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRoomHistory,
  withVisit,
  roomHistory,
  rememberRoomVisit,
  forgetRoom,
  clearRoomHistory,
  roomVisitUrl,
  openedLabel,
  type RoomVisit,
  type PagePath,
} from './roomHistory.js';
import { ROOM_HISTORY_LIMIT } from './constants.js';
import { SessionRole, type RoomId, type RoomName } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import type { EpochMs } from '../time.js';

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

beforeEach(() => { Object.keys(store).forEach((k) => delete store[k]); });

const visit = (room: string, at: number, extra: Partial<RoomVisit> = {}): RoomVisit => ({
  room: room as RoomId,
  name: null,
  key: null,
  role: SessionRole.Writer,
  openedAt: at as EpochMs,
  ...extra,
});

const PAGE = '/' as PagePath;

describe('parseRoomHistory', () => {
  it('reads an empty library when nothing is stored', () => {
    expect(parseRoomHistory(null)).toEqual([]);
  });

  it('survives a corrupted or hand-edited value instead of throwing', () => {
    expect(parseRoomHistory('not json')).toEqual([]);
    expect(parseRoomHistory('{"room":"a"}')).toEqual([]);
    expect(parseRoomHistory('[1, "x", null, {}]')).toEqual([]);
  });

  it('drops entries with no usable room id and keeps the rest', () => {
    const raw = JSON.stringify([{ room: '  ', openedAt: 5 }, { room: 'good', openedAt: 5 }]);
    expect(parseRoomHistory(raw).map((v) => v.room)).toEqual(['good']);
  });

  it('defaults a malformed timestamp, name, key and role rather than dropping the room', () => {
    const raw = JSON.stringify([{ room: 'a', openedAt: 'yesterday', name: 7, key: {}, role: 'admin' }]);
    expect(parseRoomHistory(raw)).toEqual([
      { room: 'a', name: null, key: null, role: SessionRole.Writer, openedAt: 0 },
    ]);
  });

  it('orders newest first and keeps only the newest of a duplicated room', () => {
    const raw = JSON.stringify([
      visit('a', 10),
      visit('b', 30),
      visit('a', 20, { name: 'newer' as RoomName }),
    ]);
    const parsed = parseRoomHistory(raw);
    expect(parsed.map((v) => v.room)).toEqual(['b', 'a']);
    expect(parsed[1].name).toBe('newer');
  });

  it('caps a store that grew beyond the limit', () => {
    const raw = JSON.stringify(
      Array.from({ length: ROOM_HISTORY_LIMIT + 10 }, (_, i) => visit(`r${i}`, i)),
    );
    expect(parseRoomHistory(raw)).toHaveLength(ROOM_HISTORY_LIMIT);
  });

  it('reads back a reader entry as view-only', () => {
    const raw = JSON.stringify([visit('a', 1, { role: SessionRole.Reader })]);
    expect(parseRoomHistory(raw)[0].role).toBe(SessionRole.Reader);
  });
});

describe('withVisit', () => {
  it('puts the visited room first', () => {
    const history = withVisit(withVisit([], visit('a', 1)), visit('b', 2));
    expect(history.map((v) => v.room)).toEqual(['b', 'a']);
  });

  it('moves a re-opened room to the front instead of adding it twice', () => {
    let history = withVisit([], visit('a', 1));
    history = withVisit(history, visit('b', 2));
    history = withVisit(history, visit('a', 3));
    expect(history.map((v) => v.room)).toEqual(['a', 'b']);
    expect(history[0].openedAt).toBe(3);
  });

  it('keeps a remembered key when the same room is opened without one', () => {
    const keyed = withVisit([], visit('a', 1, { key: 'secret' as RoomCredential }));
    const keyless = withVisit(keyed, visit('a', 2));
    expect(keyless[0].key).toBe('secret');
  });

  it('adopts a key for a room remembered without one', () => {
    const keyless = withVisit([], visit('a', 1));
    const keyed = withVisit(keyless, visit('a', 2, { key: 'secret' as RoomCredential }));
    expect(keyed[0].key).toBe('secret');
  });

  it('keeps the last known name while a fresh visit has not synced one yet', () => {
    const named = withVisit([], visit('a', 1, { name: 'Plan' as RoomName }));
    expect(withVisit(named, visit('a', 2))[0].name).toBe('Plan');
  });

  it('takes a new name over the remembered one', () => {
    const named = withVisit([], visit('a', 1, { name: 'Plan' as RoomName }));
    expect(withVisit(named, visit('a', 2, { name: 'Budget' as RoomName }))[0].name).toBe('Budget');
  });

  it('takes the role of the latest visit', () => {
    const read = withVisit([], visit('a', 1, { role: SessionRole.Reader }));
    expect(withVisit(read, visit('a', 2))[0].role).toBe(SessionRole.Writer);
  });

  it('evicts the least recently opened at the cap', () => {
    let history: RoomVisit[] = [];
    for (let i = 0; i < ROOM_HISTORY_LIMIT; i++) history = withVisit(history, visit(`r${i}`, i));
    expect(history).toHaveLength(ROOM_HISTORY_LIMIT);
    history = withVisit(history, visit('newest', 999));
    expect(history).toHaveLength(ROOM_HISTORY_LIMIT);
    expect(history[0].room).toBe('newest');
    expect(history.some((v) => v.room === 'r0')).toBe(false);
  });

  it('re-opening at the cap evicts nothing', () => {
    let history: RoomVisit[] = [];
    for (let i = 0; i < ROOM_HISTORY_LIMIT; i++) history = withVisit(history, visit(`r${i}`, i));
    history = withVisit(history, visit('r0', 999));
    expect(history).toHaveLength(ROOM_HISTORY_LIMIT);
    expect(history.map((v) => v.room)).toContain(`r${ROOM_HISTORY_LIMIT - 1}`);
  });
});

describe('the persisted library', () => {
  it('starts empty and round-trips a visit', () => {
    expect(roomHistory()).toEqual([]);
    rememberRoomVisit(visit('a', 5, { name: 'Plan' as RoomName, key: 'k' as RoomCredential }));
    expect(roomHistory()).toEqual([
      { room: 'a', name: 'Plan', key: 'k', role: SessionRole.Writer, openedAt: 5 },
    ]);
  });

  it('forgets one room and keeps the others', () => {
    rememberRoomVisit(visit('a', 1));
    rememberRoomVisit(visit('b', 2));
    forgetRoom('a' as RoomId);
    expect(roomHistory().map((v) => v.room)).toEqual(['b']);
  });

  it('clears the whole library', () => {
    rememberRoomVisit(visit('a', 1));
    clearRoomHistory();
    expect(roomHistory()).toEqual([]);
  });

  it('degrades to an empty library when storage throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(() => rememberRoomVisit(visit('a', 1))).not.toThrow();
    expect(roomHistory()).toEqual([]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });
});

describe('roomVisitUrl', () => {
  it('links to the room on the current page path', () => {
    expect(roomVisitUrl(visit('a', 1), PAGE)).toBe('/?room=a');
    expect(roomVisitUrl(visit('a', 1), '/copad/' as PagePath)).toBe('/copad/?room=a');
  });

  it('carries the encryption key in the fragment, never the query', () => {
    const url = roomVisitUrl(visit('a', 1, { key: 'se cret' as RoomCredential }), PAGE);
    expect(url).toBe('/?room=a#k=se%20cret');
  });

  it('reopens a view-only room as view-only', () => {
    expect(roomVisitUrl(visit('a', 1, { role: SessionRole.Reader }), PAGE)).toBe('/?room=a&role=reader');
  });

  it('escapes a room id that would otherwise alter the query', () => {
    const url = roomVisitUrl(visit('a&role=writer', 1, { role: SessionRole.Reader }), PAGE);
    expect(url).toBe('/?room=a%26role%3Dwriter&role=reader');
  });
});

describe('openedLabel', () => {
  const at = Date.parse('2026-03-04T09:00:00Z') as EpochMs;
  const after = (ms: number): EpochMs => (at + ms) as EpochMs;

  it('reads a visit within the minute as just now', () => {
    expect(openedLabel(at, after(0))).toBe('just now');
    expect(openedLabel(at, after(59_000))).toBe('just now');
  });

  it('counts minutes within the hour', () => {
    expect(openedLabel(at, after(60_000))).toBe('1m ago');
    expect(openedLabel(at, after(59 * 60_000))).toBe('59m ago');
  });

  it('counts hours within the day', () => {
    expect(openedLabel(at, after(60 * 60_000))).toBe('1h ago');
    expect(openedLabel(at, after(23 * 60 * 60_000))).toBe('23h ago');
  });

  it('falls back to a date once elapsed time stops placing the visit', () => {
    const label = openedLabel(at, after(63 * 24 * 60 * 60_000));
    expect(label).not.toMatch(/ago|just now/);
    expect(label).toBe(new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  });

  it('reads a timestamp from the future as just now rather than a negative age', () => {
    expect(openedLabel(after(60_000), at)).toBe('just now');
  });
});
