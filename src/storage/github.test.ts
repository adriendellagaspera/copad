import { describe, it, expect, vi, beforeEach } from 'vitest';
import { githubStorage } from './github.js';
import type { StorageAuth } from './auth.js';
import type { Storage, Filename } from './types.js';
import type { RoomId } from '../collaboration/types.js';
import { ClassifiedWriteError, WriteFailureKind } from './writeOutcome.js';

// Room stem is 'notes', matching the default filename ('notes.md') the tests below assert on.
const TEST_ROOM = 'notes' as RoomId;

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

function setup() {
  const { auth, storage } = githubStorage(TEST_ROOM);
  return { auth, storage };
}

function configureAndValidate(auth: StorageAuth) {
  auth.setConfig?.('repo', 'alice/notes');
  auth.setConfig?.('token', 'ghp_test');
  localStorage.setItem('storage.github.validated', '1');
}

describe('githubStorage auth', () => {
  it('is not authenticated before setup', () => {
    const { auth } = setup();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('is not authenticated when only token is set (no validated flag)', () => {
    const { auth } = setup();
    auth.setConfig?.('repo', 'alice/notes');
    auth.setConfig?.('token', 'ghp_test');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('is authenticated after validated flag + repo + token', () => {
    const { auth } = setup();
    configureAndValidate(auth);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('login validates token via GET /user and sets the validated flag', async () => {
    const { auth } = setup();
    auth.setConfig?.('repo', 'alice/notes');
    auth.setConfig?.('token', 'ghp_test');
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await auth.login();
    expect(auth.isAuthenticated()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ghp_test' }) }),
    );
  });

  it('login throws on 401', async () => {
    const { auth } = setup();
    auth.setConfig?.('repo', 'alice/notes');
    auth.setConfig?.('token', 'bad-token');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    await expect(auth.login()).rejects.toThrow('Invalid token');
  });

  it('login throws when repo or token is missing', async () => {
    const { auth } = setup();
    await expect(auth.login()).rejects.toThrow(/repository and token/i);
  });

  it('logout clears the validated flag', () => {
    const { auth } = setup();
    configureAndValidate(auth);
    expect(auth.isAuthenticated()).toBe(true);
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('changing the token devalidates (forces re-connect)', () => {
    const { auth } = setup();
    configureAndValidate(auth);
    auth.setConfig?.('token', 'ghp_new');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('changing the repo devalidates (forces re-connect)', () => {
    const { auth } = setup();
    configureAndValidate(auth);
    auth.setConfig?.('repo', 'bob/other');
    expect(auth.isAuthenticated()).toBe(false);
  });
});

describe('githubStorage config', () => {
  it('exposes repo, branch, and token configFields', () => {
    const { auth } = setup();
    const names = auth.configFields!.map(f => f.name);
    expect(names).toContain('repo');
    expect(names).toContain('branch');
    expect(names).toContain('token');
  });

  it('configured() is false when repo or token is missing', () => {
    const { auth } = setup();
    expect(auth.configured!()).toBe(false);
    auth.setConfig?.('repo', 'alice/notes');
    expect(auth.configured!()).toBe(false);
    auth.setConfig?.('token', 'ghp_test');
    expect(auth.configured!()).toBe(true);
  });

  it('configured() does not require branch (defaults to main)', () => {
    const { auth } = setup();
    auth.setConfig?.('repo', 'alice/notes');
    auth.setConfig?.('token', 'ghp_test');
    expect(auth.configured!()).toBe(true);
  });

  it('branch defaults to main when unset', () => {
    const { auth } = setup();
    expect(auth.config!('branch')).toBe('main');
  });
});

describe('githubStorage load', () => {
  let auth: StorageAuth;
  let storage: Storage;

  beforeEach(() => {
    ({ auth, storage } = setup());
    configureAndValidate(auth);
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await storage.load()).toBeNull();
  });

  it('decodes base64 text content on 200', async () => {
    const text = 'Hello, world!';
    const b64 = btoa(text);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: b64, sha: 'abc123' }),
    } as unknown as Response);
    const result = await storage.load();
    expect(result).toEqual({ format: 'text', text });
  });

  it('caches the SHA from the response for subsequent saves', async () => {
    const b64 = btoa('# Notes');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: b64, sha: 'sha-xyz' }),
    } as unknown as Response);
    await storage.load();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: { sha: 'sha-new' } }),
    } as unknown as Response);
    await storage.save({ format: 'text', text: '# Updated' });
    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string) as Record<string, unknown>;
    expect(body.sha).toBe('sha-xyz');
  });

  it('throws when not connected', async () => {
    // Clear config so this fresh instance has no token.
    localStorage.clear();
    const { storage: s } = setup();
    await expect(s.load()).rejects.toThrow('GitHub: not connected');
  });

  it('calls the correct URL with branch and path', async () => {
    auth.setConfig?.('branch', 'main');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: btoa('x'), sha: 's' }),
    } as unknown as Response);
    await storage.load();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('https://api.github.com/repos/alice/notes/contents/');
    expect(url).toContain('ref=main');
  });
});

describe('githubStorage save', () => {
  let auth: StorageAuth;
  let storage: Storage;

  beforeEach(() => {
    ({ auth, storage } = setup());
    configureAndValidate(auth);
  });

  it('calls PUT with base64-encoded text content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: { sha: 'new-sha' } }),
    } as unknown as Response);
    await storage.save({ format: 'text', text: 'hello' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/repos/alice/notes/contents/'),
      expect.objectContaining({ method: 'PUT' }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.content).toBe(btoa('hello'));
    expect(body.message).toContain('notes.md');
  });

  it('omits sha on first save (new file)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: { sha: 'first-sha' } }),
    } as unknown as Response);
    await storage.save({ format: 'text', text: 'new' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.sha).toBeUndefined();
  });

  it('encodes binary content as base64', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: { sha: 's' } }),
    } as unknown as Response);
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.save({ format: 'binary', bytes });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.content).toBe(btoa('\x01\x02\x03'));
  });

  it('throws a descriptive error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'SHA mismatch' }),
    } as unknown as Response);
    await expect(storage.save({ format: 'text', text: 'x' })).rejects.toThrow('SHA mismatch');
  });

  it('reports a WriteReceipt landing on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: { sha: 'new-sha' } }),
    } as unknown as Response);
    await expect(storage.save({ format: 'text', text: 'hello' })).resolves.toEqual({ landing: 'landed' });
  });

  it('classifies a 409 as Contended and invalidates the cached sha so the next save re-resolves it', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ message: 'sha stale' }),
    } as unknown as Response);
    let thrown: unknown;
    try {
      await storage.save({ format: 'text', text: 'x' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClassifiedWriteError);
    expect((thrown as InstanceType<typeof ClassifiedWriteError>).kind).toBe(WriteFailureKind.Contended);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: { sha: 'fresh-sha' } }),
    } as unknown as Response);
    await storage.save({ format: 'text', text: 'retry' });
    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string) as Record<string, unknown>;
    expect(body.sha).toBeUndefined();
  });

  it('classifies a 401 as Denied', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'bad token' }),
    } as unknown as Response);
    let thrown: unknown;
    try {
      await storage.save({ format: 'text', text: 'x' });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as InstanceType<typeof ClassifiedWriteError>).kind).toBe(WriteFailureKind.Denied);
  });

  it('coalesces a concurrent save into a Skipped receipt instead of silently resolving as landed', async () => {
    let resolveFirst!: (r: unknown) => void;
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    const first = storage.save({ format: 'text', text: 'a' });
    const second = await storage.save({ format: 'text', text: 'b' });
    expect(second).toEqual({ landing: 'skipped', why: 'coalesced' });
    resolveFirst({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 's' } }) });
    await first;
  });
});

describe('githubStorage contentFormat', () => {
  it('is text for .md files (the default)', () => {
    const { storage } = setup();
    expect(storage.contentFormat).toBe('text');
  });

  it('is binary for .yjs files', () => {
    const { auth, storage } = setup();
    auth.setConfig?.('repo', 'alice/notes');
    storage.setFilename?.('snapshot.yjs');
    expect(storage.contentFormat).toBe('binary');
  });

  it('is text for .txt files', () => {
    const { storage } = setup();
    storage.setFilename?.('readme.txt');
    expect(storage.contentFormat).toBe('text');
  });
});

describe('githubStorage list', () => {
  let auth: StorageAuth;
  let storage: Storage;

  beforeEach(() => {
    ({ auth, storage } = setup());
    configureAndValidate(auth);
  });

  it('lists file names from the repo root, filtering out directories', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([
        { name: 'notes.md', type: 'file' },
        { name: 'assets', type: 'dir' },
        { name: 'README.md', type: 'file' },
      ]),
    } as unknown as Response);
    expect(await storage.list!()).toEqual(['notes.md', 'README.md']);
  });

  it('calls the Contents endpoint at the repo root (no path segment)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([]) } as unknown as Response);
    await storage.list!();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe('https://api.github.com/repos/alice/notes/contents?ref=main');
  });

  it('throws a descriptive error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(storage.list!()).rejects.toThrow('GitHub list failed: 500');
  });

  it('throws when not connected', async () => {
    localStorage.clear();
    const { storage: s } = setup();
    await expect(s.list!()).rejects.toThrow('GitHub: not connected');
  });
});

describe('githubStorage loadFrom', () => {
  let auth: StorageAuth;
  let storage: Storage;

  beforeEach(() => {
    ({ auth, storage } = setup());
    configureAndValidate(auth);
  });

  it('reads an arbitrary file, independent of the configured target filename', async () => {
    const text = 'Hello from another file';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: btoa(text), sha: 'abc' }),
    } as unknown as Response);
    const result = await storage.loadFrom!('other.md' as Filename);
    expect(result).toEqual({ format: 'text', text });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/repos/alice/notes/contents/other.md');
  });

  it('picks binary format from the requested filename, not the room target', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: btoa('\x01\x02'), sha: 'abc' }),
    } as unknown as Response);
    // Room target defaults to notes.md (text) — loadFrom('backup.yjs') must still decode as binary.
    const result = await storage.loadFrom!('backup.yjs' as Filename);
    expect(result?.format).toBe('binary');
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await storage.loadFrom!('missing.md' as Filename)).toBeNull();
  });
});
