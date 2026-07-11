import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onedriveStorage } from './onedrive.js';
import type { StorageAuth } from './auth.js';
import type { Storage, Filename } from './types.js';
import type { RoomId } from '../collaboration/types.js';
import { ClassifiedWriteError, WriteFailureKind } from './writeOutcome.js';

// Room stem is 'document', matching the plain default filename ('document.yjs') asserted below.
const TEST_ROOM = 'document' as RoomId;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
});

beforeEach(() => {
  mockFetch.mockReset();
  Object.keys(store).forEach(k => delete store[k]);
});

const withToken = () => { localStorage.setItem('storage.onedrive.token', 'tok'); };

describe('onedriveStorage auth', () => {
  it('is not authenticated before login', () => {
    expect(onedriveStorage(TEST_ROOM).auth.isAuthenticated()).toBe(false);
  });

  it('reads persisted token from localStorage', () => {
    withToken();
    expect(onedriveStorage(TEST_ROOM).auth.isAuthenticated()).toBe(true);
  });

  it('logout clears the token', () => {
    withToken();
    const { auth } = onedriveStorage(TEST_ROOM);
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('exposes a clientId configField', () => {
    const names = onedriveStorage(TEST_ROOM).auth.configFields!.map(f => f.name);
    expect(names).toContain('clientId');
  });
});

describe('onedriveStorage contentFormat', () => {
  it('is binary for the default document.yjs, text for .md', () => {
    const { storage } = onedriveStorage(TEST_ROOM);
    expect(storage.contentFormat).toBe('binary');
    storage.setFilename?.('notes.md');
    expect(storage.contentFormat).toBe('text');
  });
});

describe('onedriveStorage load/save', () => {
  let auth: StorageAuth;
  let storage: Storage;
  beforeEach(() => { ({ auth, storage } = onedriveStorage(TEST_ROOM)); withToken(); void auth; });

  it('throws when not connected', async () => {
    localStorage.clear();
    await expect(onedriveStorage(TEST_ROOM).storage.load()).rejects.toThrow('OneDrive: not connected');
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await storage.load()).toBeNull();
  });

  it('loads bytes from the app-folder content endpoint', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response);
    expect(await storage.load()).toEqual({ format: 'binary', bytes });
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/special/approot:/document.yjs:/content',
    );
  });

  it('saves via PUT to the content endpoint and reports a landed WriteReceipt', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await expect(storage.save({ format: 'binary', bytes: new Uint8Array([9]) })).resolves.toEqual({ landing: 'landed' });
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/special/approot:/document.yjs:/content',
    );
  });

  it('classifies a failed save as a ClassifiedWriteError', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    let thrown: unknown;
    try {
      await storage.save({ format: 'binary', bytes: new Uint8Array([9]) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClassifiedWriteError);
    expect((thrown as InstanceType<typeof ClassifiedWriteError>).kind).toBe(WriteFailureKind.Transient);
  });
});

describe('onedriveStorage list', () => {
  let storage: Storage;
  beforeEach(() => { ({ storage } = onedriveStorage(TEST_ROOM)); withToken(); });

  it('lists file names from the app folder, filtering out sub-folders', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        value: [
          { name: 'notes.md', file: {} },
          { name: 'Archive', folder: {} },
          { name: 'document.yjs', file: {} },
        ],
      }),
    } as unknown as Response);
    expect(await storage.list!()).toEqual(['notes.md', 'document.yjs']);
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/special/approot/children',
    );
  });

  it('throws a descriptive error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(storage.list!()).rejects.toThrow('OneDrive list failed: 500');
  });

  it('throws when not connected', async () => {
    localStorage.clear();
    await expect(onedriveStorage(TEST_ROOM).storage.list!()).rejects.toThrow('OneDrive: not connected');
  });
});

describe('onedriveStorage loadFrom', () => {
  let storage: Storage;
  beforeEach(() => { ({ storage } = onedriveStorage(TEST_ROOM)); withToken(); });

  it('reads an arbitrary file, independent of the configured target filename', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response);
    const result = await storage.loadFrom!('other.yjs' as Filename);
    expect(result).toEqual({ format: 'binary', bytes });
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/special/approot:/other.yjs:/content',
    );
  });

  it('picks text format from the requested filename, not the room target', async () => {
    const bytes = new TextEncoder().encode('hello');
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response);
    // Room target defaults to document.yjs (binary) — loadFrom('notes.md') must still decode as text.
    const result = await storage.loadFrom!('notes.md' as Filename);
    expect(result).toEqual({ format: 'text', text: 'hello' });
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await storage.loadFrom!('missing.md' as Filename)).toBeNull();
  });
});

describe('onedriveStorage access', () => {
  it('reports owner when createdBy matches /me', async () => {
    withToken();
    const { storage } = onedriveStorage(TEST_ROOM);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'me' }) } as unknown as Response) // /me
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ createdBy: { user: { id: 'me' } } }) } as unknown as Response); // item
    expect(await storage.access!()).toBe('owner');
  });

  it('falls back to write when either request fails', async () => {
    withToken();
    const { storage } = onedriveStorage(TEST_ROOM);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'me' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    expect(await storage.access!()).toBe('write');
  });
});
