import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DropboxAdapter } from './dropbox.js';
import { WebDavAdapter } from './webdav.js';

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

describe('DropboxAdapter', () => {
  let adapter: DropboxAdapter;
  beforeEach(() => { adapter = new DropboxAdapter(); });

  it('is not authenticated before connect', () => {
    expect(adapter.isAuthenticated()).toBe(false);
  });

  it('reads persisted token from localStorage', () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    expect(new DropboxAdapter().isAuthenticated()).toBe(true);
  });

  it('disconnect clears token', () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    adapter.disconnect();
    expect(adapter.isAuthenticated()).toBe(false);
  });

  it('save calls Dropbox upload endpoint', async () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    await adapter.save(new Uint8Array([1, 2, 3]));
    expect(mockFetch).toHaveBeenCalledWith(
      'https://content.dropboxapi.com/2/files/upload',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('load returns null on 409 (file not found)', async () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    mockFetch.mockResolvedValueOnce({ status: 409, ok: false } as Response);
    expect(await adapter.load()).toBeNull();
  });

  it('load returns bytes on success', async () => {
    localStorage.setItem('storage.dropbox.token', 'tok');
    const bytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as unknown as Response);
    expect(await adapter.load()).toEqual(bytes);
  });

  it('load throws when not authenticated', async () => {
    await expect(adapter.load()).rejects.toThrow('Dropbox: not connected');
  });
});

// ── WebDAV ───────────────────────────────────────────────────────────────────

describe('WebDavAdapter', () => {
  let adapter: WebDavAdapter;
  beforeEach(() => { adapter = new WebDavAdapter(); });

  it('is not authenticated before connect', () => {
    expect(adapter.isAuthenticated()).toBe(false);
  });

  it('exposes credential fields', () => {
    expect(adapter.credentialFields).toBeDefined();
    expect(adapter.credentialFields!.length).toBeGreaterThan(0);
    const names = adapter.credentialFields!.map(f => f.name);
    expect(names).toContain('baseUrl');
    expect(names).toContain('username');
    expect(names).toContain('password');
  });

  it('disconnect clears config', () => {
    localStorage.setItem('storage.webdav', JSON.stringify({ baseUrl: 'x', auth: 'y' }));
    adapter.disconnect();
    expect(adapter.isAuthenticated()).toBe(false);
  });

  it('connect throws on missing URL', async () => {
    await expect(
      adapter.connect({ baseUrl: '', username: 'u', password: 'p' })
    ).rejects.toThrow('URL and username are required');
  });

  it('connect throws on 401', async () => {
    mockFetch.mockResolvedValueOnce({ status: 401, ok: false } as Response);
    await expect(
      adapter.connect({ baseUrl: 'https://cloud.example.com/dav', username: 'u', password: 'p' })
    ).rejects.toThrow('invalid credentials');
  });

  it('connect succeeds on 200', async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true } as Response);
    await adapter.connect({ baseUrl: 'https://cloud.example.com/dav', username: 'u', password: 'p' });
    expect(adapter.isAuthenticated()).toBe(true);
  });

  it('load returns null on 404', async () => {
    localStorage.setItem('storage.webdav', JSON.stringify({ baseUrl: 'https://x', auth: 'y' }));
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await adapter.load()).toBeNull();
  });

  it('save calls PUT', async () => {
    localStorage.setItem('storage.webdav', JSON.stringify({ baseUrl: 'https://x', auth: 'y' }));
    mockFetch.mockResolvedValueOnce({ status: 201, ok: true } as Response);
    await adapter.save(new Uint8Array([1, 2, 3]));
    expect(mockFetch).toHaveBeenCalledWith(
      'https://x/document.yjs',
      expect.objectContaining({ method: 'PUT' })
    );
  });
});
