import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dropboxStorage } from './dropbox.js';
import { webdavStorage } from './webdav.js';
import type { StorageAuth } from './auth.js';
import type { Storage } from './types.js';
import { LoginKind } from './types.js';
import type { Fetch } from '../network/types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Minimal localStorage shim for Node test environment.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  mockFetch.mockReset();
  localStorageMock.clear();
});

// ── Dropbox ──────────────────────────────────────────────────────────────────

describe('dropboxStorage', () => {
  let auth: StorageAuth;
  let storage: Storage;
  beforeEach(() => { ({ auth, storage } = dropboxStorage()); });

  it('is not authenticated before login', () => {
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('reads persisted token from localStorage', () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    expect(dropboxStorage().auth.isAuthenticated()).toBe(true);
  });

  it('logout clears token', () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('exposes configFields for the app key', () => {
    expect(auth.configFields).toBeDefined();
    expect(auth.configFields!.map(f => f.name)).toContain('appKey');
  });

  it('save calls Dropbox upload endpoint', async () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    await storage.save({ format: 'binary', bytes: new Uint8Array([1, 2, 3]) });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://content.dropboxapi.com/2/files/upload',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('load returns null on 409 (file not found)', async () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    mockFetch.mockResolvedValueOnce({ status: 409, ok: false } as Response);
    expect(await storage.load()).toBeNull();
  });

  it('load returns bytes on success', async () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    const bytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as unknown as Response);
    expect(await storage.load()).toEqual({ format: 'binary', bytes });
  });

  it('load throws when not authenticated', async () => {
    await expect(storage.load()).rejects.toThrow('Dropbox: not connected');
  });
});

// ── WebDAV ───────────────────────────────────────────────────────────────────

describe('webdavStorage', () => {
  let auth: StorageAuth;
  let storage: Storage;
  beforeEach(() => { ({ auth, storage } = webdavStorage(mockFetch as unknown as Fetch)); });

  it('is not authenticated before login', () => {
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('exposes credential fields', () => {
    expect(auth.credentialFields).toBeDefined();
    expect(auth.credentialFields!.length).toBeGreaterThan(0);
    const names = auth.credentialFields!.map((f: { name: string }) => f.name);
    expect(names).toContain('baseUrl');
    expect(names).toContain('username');
    expect(names).toContain('password');
  });

  it('logout clears config', () => {
    localStorage.setItem('storage.webdav.conf', JSON.stringify({ baseUrl: 'x', auth: 'y' }));
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('login throws on missing URL', async () => {
    await expect(
      auth.login({ kind: LoginKind.Credentials, credentials: { baseUrl: '', username: 'u', password: 'p' } })
    ).rejects.toThrow('URL and username are required');
  });

  it('login throws on 401', async () => {
    mockFetch.mockResolvedValueOnce({ status: 401, ok: false } as Response);
    await expect(
      auth.login({ kind: LoginKind.Credentials, credentials: { baseUrl: 'https://cloud.example.com/dav', username: 'u', password: 'p' } })
    ).rejects.toThrow('invalid credentials');
  });

  it('login succeeds on 200', async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true } as Response);
    await auth.login({ kind: LoginKind.Credentials, credentials: { baseUrl: 'https://cloud.example.com/dav', username: 'u', password: 'p' } });
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('load returns null on 404', async () => {
    localStorage.setItem('storage.webdav.conf', JSON.stringify({ baseUrl: 'https://x', auth: 'y' }));
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await storage.load()).toBeNull();
  });

  it('save calls PUT', async () => {
    localStorage.setItem('storage.webdav.conf', JSON.stringify({ baseUrl: 'https://x', auth: 'y' }));
    mockFetch.mockResolvedValueOnce({ status: 201, ok: true } as Response);
    await storage.save({ format: 'binary', bytes: new Uint8Array([1, 2, 3]) });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://x/document.yjs',
      expect.objectContaining({ method: 'PUT' })
    );
  });
});
