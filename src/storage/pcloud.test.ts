import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StorageAuth } from './auth.js';
import type { Fetch } from '../network/types.js';
import type { DocContent } from './types.js';
import { DocFormat } from './types.js';
import type { RoomId } from '../collaboration/types.js';

const popup = vi.fn();
vi.mock('pcloud-sdk-js', () => ({ default: { oauth: { popup } } }));

const TEST_ROOM = 'document' as RoomId;

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  popup.mockReset();
  localStorageMock.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

const DOC: DocContent = { format: DocFormat.Binary, bytes: new Uint8Array([1, 2, 3]) };

const replying =(body: unknown, ok = true, status = 200): Fetch =>
  (async () => ({ ok, status, json: async () => body })) as unknown as Fetch;

async function connected(netFetch: Fetch) {
  const { pcloudStorage } = await import('./pcloud.js');
  const backend = pcloudStorage(netFetch, TEST_ROOM);
  backend.auth.setConfig?.('clientId', 'my-client-id');
  popup.mockImplementation((_clientId: string, onSuccess: (t: string, l?: number) => void) => {
    onSuccess('tok-123', 1);
  });
  await backend.auth.login();
  return backend;
}

describe('pcloudStorage', () => {
  it('is not authenticated before login', async () => {
    const { pcloudStorage } = await import('./pcloud.js');
    const { auth } = pcloudStorage(vi.fn(), TEST_ROOM);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('login throws when no Client ID is configured', async () => {
    const { pcloudStorage } = await import('./pcloud.js');
    const { auth } = pcloudStorage(vi.fn(), TEST_ROOM);
    await expect(auth.login()).rejects.toThrow('Add a pCloud Client ID in Settings first.');
    expect(popup).not.toHaveBeenCalled();
  });

  it('login resolves and persists the session on a successful callback', async () => {
    const { pcloudStorage } = await import('./pcloud.js');
    const { auth } = pcloudStorage(vi.fn(), TEST_ROOM);
    auth.setConfig?.('clientId', 'my-client-id');
    popup.mockImplementation((_clientId: string, onSuccess: (t: string, l?: number) => void) => {
      onSuccess('tok-123', 1);
    });

    await auth.login();

    expect(auth.isAuthenticated()).toBe(true);
  });

  it('save reports a failure that pCloud returned inside a 200', async () => {
    const { storage } = await connected(replying({ result: 2000, error: 'Log in failed.' }));
    await expect(storage.save(DOC)).rejects.toThrow('pCloud save failed: Log in failed.');
  });

  it('save reports a non-zero result even with no error text', async () => {
    const { storage } = await connected(replying({ result: 2008 }));
    await expect(storage.save(DOC)).rejects.toThrow('pCloud save failed: error 2008');
  });

  it('save reports an accepted upload that stored no file', async () => {
    const { storage } = await connected(replying({ result: 0, fileids: [] }));
    await expect(storage.save(DOC)).rejects.toThrow('the upload stored no file');
  });

  it('save resolves when pCloud confirms a stored file', async () => {
    const { storage } = await connected(replying({ result: 0, fileids: [98765] }));
    await expect(storage.save(DOC)).resolves.toEqual({ landing: 'landed' });
  });

  it('save still reports a transport-level failure', async () => {
    const { storage } = await connected(replying({ result: 0, fileids: [1] }, false, 503));
    await expect(storage.save(DOC)).rejects.toThrow('pCloud save failed: 503');
  });

  it('login times out with a clear error if the SDK never calls back', async () => {
    vi.useFakeTimers();
    const { pcloudStorage } = await import('./pcloud.js');
    const { auth }: { auth: StorageAuth } = pcloudStorage(vi.fn(), TEST_ROOM);
    auth.setConfig?.('clientId', 'my-client-id');
    popup.mockImplementation(() => {});

    const pending = auth.login();
    const assertion = expect(pending).rejects.toThrow(
      'pCloud auth timed out — check that popups are allowed for this site.',
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(auth.isAuthenticated()).toBe(false);
  });
});
