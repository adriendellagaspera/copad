// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { recentRooms, recordRoomVisit, updateRecentRoomName } from './recentRooms.js';
import { RECENT_ROOMS_MAX } from './constants.js';
import type { RoomId, RoomName } from './types.js';

const id = (s: string) => s as RoomId;
const nm = (s: string) => s as RoomName;

beforeEach(() => localStorage.clear());

describe('recordRoomVisit', () => {
  it('records a visit and reads it back', () => {
    recordRoomVisit(id('alpha'), nm('Alpha'));
    const list = recentRooms();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('alpha');
    expect(list[0].name).toBe('Alpha');
  });

  it('moves a re-visited room to the front', () => {
    recordRoomVisit(id('a'), null);
    recordRoomVisit(id('b'), null);
    recordRoomVisit(id('a'), null);
    expect(recentRooms().map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('preserves a previously-known name when re-visited with null', () => {
    recordRoomVisit(id('a'), nm('Alpha'));
    recordRoomVisit(id('a'), null);
    expect(recentRooms()[0].name).toBe('Alpha');
  });

  it('caps the list at RECENT_ROOMS_MAX, dropping the oldest', () => {
    for (let i = 0; i < RECENT_ROOMS_MAX + 5; i++) recordRoomVisit(id(`r${i}`), null);
    const list = recentRooms();
    expect(list).toHaveLength(RECENT_ROOMS_MAX);
    // Most-recent first; the very first rooms fell off the end.
    expect(list[0].id).toBe(`r${RECENT_ROOMS_MAX + 4}`);
    expect(list.some((r) => r.id === 'r0')).toBe(false);
  });
});

describe('updateRecentRoomName', () => {
  it('updates the name of a remembered room', () => {
    recordRoomVisit(id('a'), null);
    updateRecentRoomName(id('a'), nm('Renamed'));
    expect(recentRooms()[0].name).toBe('Renamed');
  });

  it('is a no-op for an unknown room', () => {
    updateRecentRoomName(id('ghost'), nm('Nope'));
    expect(recentRooms()).toHaveLength(0);
  });

  it('can clear a name back to null', () => {
    recordRoomVisit(id('a'), nm('Alpha'));
    updateRecentRoomName(id('a'), null);
    expect(recentRooms()[0].name).toBeNull();
  });
});
