import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filenameStore, setActiveRoom, setDefaultRoom } from './filename.js';
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
  setDefaultRoom(HOME);
  setActiveRoom(HOME);
});

describe('filenameStore — per-room targets', () => {
  it('the home room keeps the plain default filename (back-compat)', () => {
    setActiveRoom(HOME);
    expect(filenameStore(STORAGE_ID.dropbox).get()).toBe('document.yjs');
  });

  it('a non-home room derives its own file from the room id, keeping the extension', () => {
    setActiveRoom(OTHER);
    expect(filenameStore(STORAGE_ID.dropbox).get()).toBe('my-notes.yjs');
  });

  it('preserves a text backend’s default extension for derived names', () => {
    setActiveRoom(OTHER);
    // GitHub defaults to notes.md → derived name keeps .md
    expect(filenameStore(STORAGE_ID.github, 'notes.md' as Filename).get()).toBe('my-notes.md');
  });

  it('two rooms on one backend never share a file by default', () => {
    const fn = filenameStore(STORAGE_ID.dropbox);
    setActiveRoom(HOME);
    const home = fn.get();
    setActiveRoom(OTHER);
    const other = fn.get();
    expect(home).not.toBe(other);
  });

  it('set() writes the current room’s file; rooms stay independent', () => {
    const fn = filenameStore(STORAGE_ID.dropbox);
    setActiveRoom(OTHER);
    fn.set('report.md');
    expect(fn.get()).toBe('report.md');
    setActiveRoom(HOME);
    expect(fn.get()).toBe('document.yjs'); // unchanged
    setActiveRoom(OTHER);
    expect(fn.get()).toBe('report.md');
  });

  it('sanitises unsafe characters in a room id when deriving a filename', () => {
    setActiveRoom('a/b c?d' as RoomId);
    expect(filenameStore(STORAGE_ID.dropbox).get()).toBe('a-b-c-d.yjs');
  });

  it('migrates a legacy global filename onto the home room, then drops it', () => {
    store['storage.dropbox.filename'] = 'legacy.md'; // pre-per-room custom name
    setActiveRoom(HOME);
    expect(filenameStore(STORAGE_ID.dropbox).get()).toBe('legacy.md');
    expect(store['storage.dropbox.filename']).toBeUndefined();       // legacy key cleared
    expect(store['storage.dropbox.filename.copad-demo']).toBe('legacy.md'); // moved per-room
  });

  it('does not migrate when no legacy filename was ever set', () => {
    setActiveRoom(HOME);
    expect(filenameStore(STORAGE_ID.dropbox).get()).toBe('document.yjs');
    expect(store['storage.dropbox.filename.copad-demo']).toBeUndefined();
  });
});
