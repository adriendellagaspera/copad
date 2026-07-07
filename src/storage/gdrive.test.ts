import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gdriveStorage } from './gdrive.js';
import type { StorageAuth } from './auth.js';
import type { Storage } from './types.js';
import type { RoomId } from '../collaboration/types.js';

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

const withToken = () => { localStorage.setItem('storage.gdrive.token', 'tok'); };

describe('gdriveStorage auth', () => {
  it('is not authenticated before login', () => {
    expect(gdriveStorage(TEST_ROOM).auth.isAuthenticated()).toBe(false);
  });

  it('reads persisted token from localStorage', () => {
    withToken();
    expect(gdriveStorage(TEST_ROOM).auth.isAuthenticated()).toBe(true);
  });

  it('logout clears the token', () => {
    withToken();
    const { auth } = gdriveStorage(TEST_ROOM);
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('exposes a clientId configField', () => {
    const names = gdriveStorage(TEST_ROOM).auth.configFields!.map(f => f.name);
    expect(names).toContain('clientId');
  });
});

describe('gdriveStorage contentFormat', () => {
  it('is binary for the default document.yjs, text for .md', () => {
    const { storage } = gdriveStorage(TEST_ROOM);
    expect(storage.contentFormat).toBe('binary');
    storage.setFilename?.('notes.md');
    expect(storage.contentFormat).toBe('text');
  });
});

describe('gdriveStorage load', () => {
  let auth: StorageAuth;
  let storage: Storage;
  beforeEach(() => { ({ auth, storage } = gdriveStorage(TEST_ROOM)); withToken(); void auth; });

  it('throws when not connected', async () => {
    localStorage.clear();
    await expect(gdriveStorage(TEST_ROOM).storage.load()).rejects.toThrow('Google Drive: not connected');
  });

  it('returns null when the file does not exist', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [] }) } as unknown as Response);
    expect(await storage.load()).toBeNull();
  });

  it('finds an existing file by name then downloads its bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [{ id: 'fid' }] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response);
    expect(await storage.load()).toEqual({ format: 'binary', bytes });
    // First call is the name search, second the media download of the found id.
    expect(mockFetch.mock.calls[0][0]).toContain('q=');
    expect(mockFetch.mock.calls[1][0]).toContain('/fid?alt=media');
  });
});

describe('gdriveStorage save', () => {
  let storage: Storage;
  beforeEach(() => { ({ storage } = gdriveStorage(TEST_ROOM)); withToken(); });

  it('creates the file (search empty → POST metadata → PATCH media)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [] }) } as unknown as Response) // search
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'new-id' }) } as unknown as Response) // create
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response); // media PATCH
    await storage.save({ format: 'binary', bytes: new Uint8Array([9]) });
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    expect(mockFetch.mock.calls[2][1].method).toBe('PATCH');
    expect(mockFetch.mock.calls[2][0]).toContain('/new-id?uploadType=media');
  });

  it('updates an existing file with a single media PATCH', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [{ id: 'fid' }] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await storage.save({ format: 'binary', bytes: new Uint8Array([9]) });
    expect(mockFetch.mock.calls[1][1].method).toBe('PATCH');
    expect(mockFetch.mock.calls[1][0]).toContain('/fid?uploadType=media');
  });

  it('drops a second save that overlaps an in-flight one, instead of racing to create two files', async () => {
    // The search resolves only once we let it — while it's pending, a second
    // save() call must not also start a "no fileId yet" create.
    let resolveSearch!: (v: unknown) => void;
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSearch = () => resolve({ ok: true, json: () => Promise.resolve({ files: [] }) }); }),
    );
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'new-id' }) } as unknown as Response) // create
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response); // media PATCH

    const first = storage.save({ format: 'binary', bytes: new Uint8Array([9]) });
    const second = storage.save({ format: 'binary', bytes: new Uint8Array([9]) }); // dropped: committing already true
    resolveSearch({});
    await Promise.all([first, second]);

    // Exactly one search + one create + one PATCH — never a second create.
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1);
  });
});

describe('gdriveStorage access', () => {
  it('returns write when no file exists yet', async () => {
    withToken();
    const { storage } = gdriveStorage(TEST_ROOM);
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [] }) } as unknown as Response);
    expect(await storage.access!()).toBe('write');
  });

  it('reflects capabilities.canEdit for an existing file', async () => {
    withToken();
    const { storage } = gdriveStorage(TEST_ROOM);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [{ id: 'fid' }] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ capabilities: { canEdit: false } }) } as unknown as Response);
    expect(await storage.access!()).toBe('read');
  });
});
