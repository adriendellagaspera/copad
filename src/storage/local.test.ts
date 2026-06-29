// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localFsStorage } from './local.js';
import type { StorageAuth } from './auth.js';
import type { Storage } from './types.js';
import { LoginKind, OpenMode } from './types.js';

// happy-dom has no showOpenFilePicker, so every test here exercises the
// <input type="file"> fallback path (mobile / Firefox), not the native one.

describe('localFsStorage — fallback path (no File System Access API)', () => {
  let auth: StorageAuth;
  let storage: Storage;

  beforeEach(() => {
    ({ auth, storage } = localFsStorage());
    auth.logout(); // reset module-level state to idle between tests
  });

  it('is not authenticated before login', () => {
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('reports available in a secure context', () => {
    vi.stubGlobal('isSecureContext', true);
    expect(storage.availability).toEqual({ ok: true });
    vi.unstubAllGlobals();
  });

  it('reports unavailable in an insecure context', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(storage.availability.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  describe('"New file" (no native picker)', () => {
    beforeEach(async () => {
      await auth.login({ kind: LoginKind.Open, mode: OpenMode.New });
    });

    it('authenticates without touching the filesystem', () => {
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('defaults the filename to document.yjs', () => {
      expect(storage.filename!()).toBe('document.yjs');
    });

    it('loads as an empty document (content comes from peers)', async () => {
      expect(await storage.load()).toBeNull();
    });

    it('save is a no-op — it resolves without throwing', async () => {
      await expect(
        storage.save({ format: 'binary', bytes: new Uint8Array([1, 2, 3]) }),
      ).resolves.toBeUndefined();
    });
  });

  it('save rejects non-binary content', async () => {
    await auth.login({ kind: LoginKind.Open, mode: OpenMode.New });
    await expect(
      storage.save({ format: 'text', text: 'hello' }),
    ).rejects.toThrow('expects binary content');
  });

  it('logout returns to the disconnected state', async () => {
    await auth.login({ kind: LoginKind.Open, mode: OpenMode.New });
    auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('load throws when disconnected', async () => {
    await expect(storage.load()).rejects.toThrow('Local: not connected');
  });

  it('save throws when disconnected (not a silent no-op)', async () => {
    await expect(
      storage.save({ format: 'binary', bytes: new Uint8Array([1]) }),
    ).rejects.toThrow('Local: not connected');
  });
});
