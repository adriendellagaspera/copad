import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publicAccess, sitePassword, roomPassword, setRoomPassword, clearRoomPassword } from './roomAccess.js';
import type { RoomId } from './types.js';

const ROOM = 'my-room' as RoomId;
const OTHER = 'other-room' as RoomId;

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

describe('publicAccess', () => {
  it('has mode public', () => {
    expect(publicAccess().mode).toBe('public');
  });
  it('credential is always null', () => {
    expect(publicAccess().credential(ROOM)).toBeNull();
  });
});

describe('sitePassword', () => {
  it('has mode site-password', () => {
    expect(sitePassword('x').mode).toBe('site-password');
  });
  it('returns the password as credential regardless of room', () => {
    const a = sitePassword('mysecret');
    expect(a.credential(ROOM)).toBe('mysecret');
    expect(a.credential(OTHER)).toBe('mysecret');
  });
  it('returns null when password is empty', () => {
    expect(sitePassword('').credential(ROOM)).toBeNull();
  });
  it('returns null when password is whitespace-only', () => {
    expect(sitePassword('   ').credential(ROOM)).toBeNull();
  });
  it('trims surrounding whitespace', () => {
    expect(sitePassword('  secret  ').credential(ROOM)).toBe('secret');
  });
});

describe('roomPassword', () => {
  it('has mode room-password', () => {
    expect(roomPassword().mode).toBe('room-password');
  });
  it('returns null when no password is set for the room', () => {
    expect(roomPassword().credential(ROOM)).toBeNull();
  });
  it('returns the stored password after setRoomPassword', () => {
    setRoomPassword(ROOM, 'hunter2');
    expect(roomPassword().credential(ROOM)).toBe('hunter2');
  });
  it('returns null after clearing with empty string', () => {
    setRoomPassword(ROOM, 'pw');
    setRoomPassword(ROOM, '');
    expect(roomPassword().credential(ROOM)).toBeNull();
  });
  it('returns null after clearRoomPassword', () => {
    setRoomPassword(ROOM, 'pw');
    clearRoomPassword(ROOM);
    expect(roomPassword().credential(ROOM)).toBeNull();
  });
  it('is room-specific — different rooms have independent credentials', () => {
    setRoomPassword(ROOM, 'pw-a');
    expect(roomPassword().credential(OTHER)).toBeNull();
  });
  it('different rooms can have different passwords', () => {
    setRoomPassword(ROOM, 'pw-a');
    setRoomPassword(OTHER, 'pw-b');
    expect(roomPassword().credential(ROOM)).toBe('pw-a');
    expect(roomPassword().credential(OTHER)).toBe('pw-b');
  });
});
