import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sharepointStorage } from './sharepoint.js';
import type { StorageAuth } from './auth.js';
import type { Storage } from './types.js';
import { LoginKind } from './types.js';

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

const creds = (o: Record<string, string>) => ({ kind: LoginKind.Credentials, credentials: o });
const connected = () =>
  localStorage.setItem('storage.sharepoint.conf', JSON.stringify({ token: 't', siteId: null, folder: 'Documents' }));

describe('sharepointStorage auth', () => {
  it('is not authenticated before login', () => {
    expect(sharepointStorage().auth.isAuthenticated()).toBe(false);
  });

  it('exposes token, siteUrl, folder credential fields', () => {
    const names = sharepointStorage().auth.credentialFields!.map(f => f.name);
    expect(names).toEqual(expect.arrayContaining(['token', 'siteUrl', 'folder']));
  });

  it('login requires a token', async () => {
    await expect(sharepointStorage().auth.login(creds({ token: '' }))).rejects.toThrow('access token is required');
  });

  it('login throws on 401 from /me', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    await expect(sharepointStorage().auth.login(creds({ token: 'bad' }))).rejects.toThrow('invalid or expired');
  });

  it('login validates /me and stores a OneDrive session (no siteUrl)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 'me' }) } as unknown as Response);
    const { auth } = sharepointStorage();
    await auth.login(creds({ token: 'good' }));
    expect(auth.isAuthenticated()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/me', expect.anything());
  });

  it('login resolves a SharePoint site id when a siteUrl is given', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 'me' }) } as unknown as Response) // /me
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 'site-42' }) } as unknown as Response); // /sites
    const { auth } = sharepointStorage();
    await auth.login(creds({ token: 'good', siteUrl: 'https://contoso.sharepoint.com/sites/x' }));
    expect(JSON.parse(store['storage.sharepoint.conf']).siteId).toBe('site-42');
  });

  it('logout clears the session', () => {
    connected();
    const { auth } = sharepointStorage();
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });
});

describe('sharepointStorage load/save', () => {
  let auth: StorageAuth;
  let storage: Storage;
  beforeEach(() => { ({ auth, storage } = sharepointStorage()); connected(); void auth; });

  it('throws when not connected', async () => {
    localStorage.clear();
    await expect(sharepointStorage().storage.load()).rejects.toThrow('SharePoint: not connected');
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await storage.load()).toBeNull();
  });

  it('loads bytes from the OneDrive content endpoint', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response);
    expect(await storage.load()).toEqual({ format: 'binary', bytes });
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/root:/Documents/document.yjs:/content',
    );
  });

  it('saves via PUT to the content endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await storage.save({ format: 'binary', bytes: new Uint8Array([9]) });
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
  });
});

describe('sharepointStorage access/contentFormat', () => {
  it('is binary by default, text for .md', () => {
    const { storage } = sharepointStorage();
    expect(storage.contentFormat).toBe('binary');
    storage.setFilename?.('notes.md');
    expect(storage.contentFormat).toBe('text');
  });

  it('reports owner when createdBy matches /me', async () => {
    connected();
    const { storage } = sharepointStorage();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'me' }) } as unknown as Response) // /me
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ createdBy: { user: { id: 'me' } } }) } as unknown as Response); // item
    expect(await storage.access!()).toBe('owner');
  });
});
