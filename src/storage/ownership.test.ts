import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ownershipStore } from './ownership.js';
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

describe('ownershipStore', () => {
  it('owns no room by default', () => {
    const s = ownershipStore(STORAGE_ID.dropbox);
    expect(s.owns(ROOM)).toBe(false);
    expect(s.rooms()).toEqual([]);
  });

  it('owns a room after claim', () => {
    ownershipStore(STORAGE_ID.dropbox).claim(ROOM);
    expect(ownershipStore(STORAGE_ID.dropbox).owns(ROOM)).toBe(true);
  });

  it('a backend can own several rooms at once (each keeps its own document)', () => {
    const s = ownershipStore(STORAGE_ID.dropbox);
    s.claim(ROOM);
    s.claim(OTHER);
    expect(s.owns(ROOM)).toBe(true);
    expect(s.owns(OTHER)).toBe(true);
    expect(s.rooms()).toEqual([ROOM, OTHER]);
  });

  it('claim is idempotent — no duplicate entries', () => {
    const s = ownershipStore(STORAGE_ID.dropbox);
    s.claim(ROOM);
    s.claim(ROOM);
    expect(s.rooms()).toEqual([ROOM]);
  });

  it('release removes just that room, leaving others owned', () => {
    const s = ownershipStore(STORAGE_ID.dropbox);
    s.claim(ROOM);
    s.claim(OTHER);
    s.release(ROOM);
    expect(s.owns(ROOM)).toBe(false);
    expect(s.owns(OTHER)).toBe(true);
  });

  it('is per backend — each backend has an independent owned set', () => {
    ownershipStore(STORAGE_ID.dropbox).claim(ROOM);
    ownershipStore(STORAGE_ID.github).claim(OTHER);
    expect(ownershipStore(STORAGE_ID.dropbox).owns(ROOM)).toBe(true);
    expect(ownershipStore(STORAGE_ID.dropbox).owns(OTHER)).toBe(false);
    expect(ownershipStore(STORAGE_ID.github).owns(OTHER)).toBe(true);
  });
});
