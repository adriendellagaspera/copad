import { describe, it, expect, vi, beforeEach } from 'vitest';
import { s3Storage } from './s3.js';
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

const FULL = {
  endpoint: 'https://s3.eu-west-1.amazonaws.com',
  bucket: 'my-bucket',
  region: 'eu-west-1',
  prefix: 'copad',
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
};
const creds = (o: Record<string, string>) => ({ kind: LoginKind.Credentials, credentials: o });
const connected = () => localStorage.setItem('storage.s3.conf', JSON.stringify(FULL));

describe('s3Storage auth', () => {
  it('is not authenticated before login', () => {
    expect(s3Storage().auth.isAuthenticated()).toBe(false);
  });

  it('exposes all credential fields', () => {
    const names = s3Storage().auth.credentialFields!.map(f => f.name);
    expect(names).toEqual(
      expect.arrayContaining(['endpoint', 'bucket', 'region', 'prefix', 'accessKeyId', 'secretAccessKey']),
    );
  });

  it('login requires the mandatory fields', async () => {
    await expect(s3Storage().auth.login(creds({ endpoint: '', bucket: '' }))).rejects.toThrow(/required/);
  });

  it('login signs the validation request with SigV4 and stores the conf', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const { auth } = s3Storage();
    await auth.login(creds(FULL));
    expect(auth.isAuthenticated()).toBe(true);
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toContain('AWS4-HMAC-SHA256');
    expect(headers.Authorization).toContain('Credential=AKIA/');
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('login throws on 403 (access denied)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    await expect(s3Storage().auth.login(creds(FULL))).rejects.toThrow('access denied');
  });

  it('login tolerates 405 (Method Not Allowed) as a reachable bucket', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 405 } as Response);
    const { auth } = s3Storage();
    await auth.login(creds(FULL));
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('logout clears the conf', () => {
    connected();
    const { auth } = s3Storage();
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });
});

describe('s3Storage load/save', () => {
  let auth: StorageAuth;
  let storage: Storage;
  beforeEach(() => { ({ auth, storage } = s3Storage()); connected(); void auth; });

  it('throws when not connected', async () => {
    localStorage.clear();
    await expect(s3Storage().storage.load()).rejects.toThrow('S3: not connected');
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await storage.load()).toBeNull();
  });

  it('loads bytes from the path-style object URL', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response);
    expect(await storage.load()).toEqual({ format: 'binary', bytes });
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://s3.eu-west-1.amazonaws.com/my-bucket/copad/document.yjs',
    );
  });

  it('saves via a signed PUT', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await storage.save({ format: 'binary', bytes: new Uint8Array([9]) });
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toContain('AWS4-HMAC-SHA256');
  });

  it('rejects non-binary content', async () => {
    await expect(storage.save({ format: 'text', text: 'x' })).rejects.toThrow('expects binary');
  });
});

describe('s3Storage misc', () => {
  it('is binary-only and reports write access', async () => {
    const { storage } = s3Storage();
    expect(storage.contentFormat).toBe('binary');
    expect(await storage.access!()).toBe('write');
  });
});
