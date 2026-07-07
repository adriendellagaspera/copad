import { describe, it, expect, beforeEach, vi } from 'vitest';
import { filenameStore, filenameForRoom, firstFileCollision } from './filename.js';
import { STORAGE_ID } from './constants.js';
import type { Filename } from './types.js';
import type { RoomId } from '../collaboration/types.js';

const HOME = 'copad-demo' as RoomId;
const OTHER = 'my-notes' as RoomId;

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
});

describe('filenameStore — per-room targets', () => {
  it('every room derives its own file from the room id, keeping the extension', () => {
    expect(filenameStore(STORAGE_ID.dropbox, HOME).get()).toBe('copad-demo.yjs');
    expect(filenameStore(STORAGE_ID.dropbox, OTHER).get()).toBe('my-notes.yjs');
  });

  it('preserves a text backend’s default extension for derived names', () => {
    // GitHub defaults to notes.md → derived name keeps .md
    expect(filenameStore(STORAGE_ID.github, OTHER, 'notes.md' as Filename).get()).toBe('my-notes.md');
  });

  it('two rooms on one backend never share a file by default', () => {
    const home = filenameStore(STORAGE_ID.dropbox, HOME).get();
    const other = filenameStore(STORAGE_ID.dropbox, OTHER).get();
    expect(home).not.toBe(other);
  });

  it('set() writes the room’s file; rooms stay independent', () => {
    const other = filenameStore(STORAGE_ID.dropbox, OTHER);
    other.set('report.md');
    expect(other.get()).toBe('report.md');
    expect(filenameStore(STORAGE_ID.dropbox, HOME).get()).toBe('copad-demo.yjs'); // unaffected
    expect(filenameStore(STORAGE_ID.dropbox, OTHER).get()).toBe('report.md'); // a fresh store for the same room reads it back
  });

  it('sanitises unsafe characters in a room id when deriving a filename', () => {
    expect(filenameStore(STORAGE_ID.dropbox, 'a/b c?d' as RoomId).get()).toBe('a-b-c-d.yjs');
  });

  it('filenameForRoom reads a specific room without constructing a store', () => {
    expect(filenameForRoom(STORAGE_ID.dropbox, OTHER)).toBe('my-notes.yjs');
    expect(filenameForRoom(STORAGE_ID.dropbox, HOME)).toBe('copad-demo.yjs');
  });
});

describe('firstFileCollision', () => {
  const A = 'a' as RoomId;
  const B = 'b' as RoomId;
  const C = 'c' as RoomId;
  const f = (s: string) => s as unknown as import('./types.js').Filename;

  it('returns null when the current room’s file is unique', () => {
    const files = new Map([[A, f('a.yjs')], [B, f('b.yjs')]]);
    expect(firstFileCollision(A, files)).toBeNull();
  });

  it('finds another room that resolves to the same file', () => {
    const files = new Map([[A, f('notes.md')], [B, f('other.md')], [C, f('notes.md')]]);
    expect(firstFileCollision(A, files)).toBe(C);
  });

  it('returns null when the current room is absent from the map', () => {
    expect(firstFileCollision(A, new Map([[B, f('b.yjs')]]))).toBeNull();
  });
});
