import { describe, it, expect, vi, beforeEach } from 'vitest';
import { savedRoomsStore } from './savedRooms.js';
import { STORAGE_ID } from './constants.js';
import type { RoomId } from '../collaboration/types.js';

const ROOM = 'my-room' as RoomId;
const OTHER = 'other-room' as RoomId;

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

beforeEach(() => { Object.keys(store).forEach((k) => delete store[k]); });

describe('savedRoomsStore', () => {
  it('saves no room by default', () => {
    const s = savedRoomsStore(STORAGE_ID.dropbox);
    expect(s.saves(ROOM)).toBe(false);
    expect(s.all()).toEqual([]);
  });

  it('saves a room after add', () => {
    savedRoomsStore(STORAGE_ID.dropbox).add(ROOM);
    expect(savedRoomsStore(STORAGE_ID.dropbox).saves(ROOM)).toBe(true);
  });

  it('a backend can save several rooms at once (each keeps its own document)', () => {
    const s = savedRoomsStore(STORAGE_ID.dropbox);
    s.add(ROOM);
    s.add(OTHER);
    expect(s.saves(ROOM)).toBe(true);
    expect(s.saves(OTHER)).toBe(true);
    expect(s.all()).toEqual([ROOM, OTHER]);
  });

  it('add is idempotent — no duplicate entries', () => {
    const s = savedRoomsStore(STORAGE_ID.dropbox);
    s.add(ROOM);
    s.add(ROOM);
    expect(s.all()).toEqual([ROOM]);
  });

  it('remove drops just that room, leaving others saved', () => {
    const s = savedRoomsStore(STORAGE_ID.dropbox);
    s.add(ROOM);
    s.add(OTHER);
    s.remove(ROOM);
    expect(s.saves(ROOM)).toBe(false);
    expect(s.saves(OTHER)).toBe(true);
  });

  it('is per backend — each backend has an independent saved set', () => {
    savedRoomsStore(STORAGE_ID.dropbox).add(ROOM);
    savedRoomsStore(STORAGE_ID.github).add(OTHER);
    expect(savedRoomsStore(STORAGE_ID.dropbox).saves(ROOM)).toBe(true);
    expect(savedRoomsStore(STORAGE_ID.dropbox).saves(OTHER)).toBe(false);
    expect(savedRoomsStore(STORAGE_ID.github).saves(OTHER)).toBe(true);
  });
});
