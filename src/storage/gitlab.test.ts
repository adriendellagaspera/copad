import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gitlabStorage } from './gitlab.js';
import type { StorageAuth } from './auth.js';
import type { Storage } from './types.js';
import type { RoomId } from '../collaboration/types.js';

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
  return gitlabStorage(TEST_ROOM);
}

function configureAndValidate(auth: StorageAuth) {
  auth.setConfig?.('project', 'alice/notes');
  auth.setConfig?.('token', 'glpat-test');
  localStorage.setItem('storage.gitlab.validated', '1');
}

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('gitlabStorage auth', () => {
  it('is not authenticated before setup', () => {
    expect(setup().auth.isAuthenticated()).toBe(false);
  });

  it('is not authenticated when only token is set (no validated flag)', () => {
    const { auth } = setup();
    auth.setConfig?.('project', 'alice/notes');
    auth.setConfig?.('token', 'glpat-test');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('is authenticated after validated flag + project + token', () => {
    const { auth } = setup();
    configureAndValidate(auth);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('login validates token via GET /user and sets the validated flag', async () => {
    const { auth } = setup();
    auth.setConfig?.('project', 'alice/notes');
    auth.setConfig?.('token', 'glpat-test');
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await auth.login();
    expect(auth.isAuthenticated()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/user',
      expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-test' }) }),
    );
  });

  it('login throws on 401', async () => {
    const { auth } = setup();
    auth.setConfig?.('project', 'alice/notes');
    auth.setConfig?.('token', 'bad');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    await expect(auth.login()).rejects.toThrow('Invalid token');
  });

  it('login throws when project or token is missing', async () => {
    await expect(setup().auth.login()).rejects.toThrow(/project and token/i);
  });

  it('logout clears the validated flag', () => {
    const { auth } = setup();
    configureAndValidate(auth);
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('changing the token devalidates (forces re-connect)', () => {
    const { auth } = setup();
    configureAndValidate(auth);
    auth.setConfig?.('token', 'glpat-new');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('changing the project devalidates (forces re-connect)', () => {
    const { auth } = setup();
    configureAndValidate(auth);
    auth.setConfig?.('project', 'bob/other');
    expect(auth.isAuthenticated()).toBe(false);
  });
});

// ── Config ───────────────────────────────────────────────────────────────────

describe('gitlabStorage config', () => {
  it('exposes project, host, branch, and token configFields', () => {
    const names = setup().auth.configFields!.map(f => f.name);
    expect(names).toEqual(expect.arrayContaining(['project', 'host', 'branch', 'token']));
  });

  it('configured() requires project and token', () => {
    const { auth } = setup();
    expect(auth.configured!()).toBe(false);
    auth.setConfig?.('project', 'alice/notes');
    expect(auth.configured!()).toBe(false);
    auth.setConfig?.('token', 'glpat-test');
    expect(auth.configured!()).toBe(true);
  });

  it('host defaults to gitlab.com and branch to main', () => {
    const { auth } = setup();
    expect(auth.config!('host')).toBe('https://gitlab.com');
    expect(auth.config!('branch')).toBe('main');
  });

  it('rejects a bare single-segment project (needs namespace/project)', () => {
    const { auth } = setup();
    auth.setConfig?.('project', 'notes');
    auth.setConfig?.('token', 'glpat-test');
    expect(auth.isAuthenticated()).toBe(false);
  });
});

// ── Load / Save ──────────────────────────────────────────────────────────────

describe('gitlabStorage load/save', () => {
  let auth: StorageAuth;
  let storage: Storage;
  beforeEach(() => { ({ auth, storage } = setup()); configureAndValidate(auth); });

  it('returns null on 404 and marks the file absent', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false } as Response);
    expect(await storage.load()).toBeNull();
  });

  it('decodes base64 text content (default notes.md → text)', async () => {
    const b64 = btoa('# Notes');
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.resolve({ content: b64 }),
    } as unknown as Response);
    expect(await storage.load()).toEqual({ format: 'text', text: '# Notes' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('https://gitlab.com/api/v4/projects/alice%2Fnotes/repository/files/');
    expect(url).toContain('ref=main');
  });

  it('throws when not connected', async () => {
    localStorage.clear();
    await expect(setup().storage.load()).rejects.toThrow('GitLab: not connected');
  });

  it('creates with POST when the file is absent, then base64-encodes the body', async () => {
    // save with unknown existence → existence GET (404) → POST create
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response); // existence probe
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 } as Response);  // POST create
    await storage.save({ format: 'text', text: 'hello' });
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string) as Record<string, unknown>;
    expect(body.content).toBe(btoa('hello'));
    expect(body.encoding).toBe('base64');
  });

  it('updates with PUT once the file is known to exist (via load)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.resolve({ content: btoa('x') }),
    } as unknown as Response); // load → exists
    await storage.load();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response); // save PUT
    await storage.save({ format: 'text', text: 'y' });
    expect(mockFetch.mock.calls[1][1].method).toBe('PUT');
  });

  it('throws a descriptive error on save failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response); // existence
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response); // POST fails
    await expect(storage.save({ format: 'text', text: 'x' })).rejects.toThrow('GitLab save failed: 403');
  });
});

// ── contentFormat + access ────────────────────────────────────────────────────

describe('gitlabStorage contentFormat/access', () => {
  it('is text for .md (default) and binary for .yjs', () => {
    const { storage } = setup();
    expect(storage.contentFormat).toBe('text');
    storage.setFilename?.('snapshot.yjs');
    expect(storage.contentFormat).toBe('binary');
  });

  it('access maps GitLab levels: Owner(50)→owner, Developer(30)→write, else read', async () => {
    const { auth, storage } = setup();
    configureAndValidate(auth);
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.resolve({ permissions: { project_access: { access_level: 50 } } }),
    } as unknown as Response);
    expect(await storage.access!()).toBe('owner');
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.resolve({ permissions: { project_access: { access_level: 30 } } }),
    } as unknown as Response);
    expect(await storage.access!()).toBe('write');
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.resolve({ permissions: { project_access: { access_level: 10 } } }),
    } as unknown as Response);
    expect(await storage.access!()).toBe('read');
  });
});
