import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StorageAuth } from './auth.js';
import type { RoomId } from '../collaboration/types.js';

// pcloud-sdk-js's popup() is the actual IO boundary here (see pcloud.ts) — mock
// its shape so tests control exactly when/whether the success/error callback fires.
const popup = vi.fn();
vi.mock('pcloud-sdk-js', () => ({ default: { oauth: { popup } } }));

const TEST_ROOM = 'document' as RoomId;

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
  popup.mockReset();
  localStorageMock.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

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

  it('login times out with a clear error if the SDK never calls back', async () => {
    vi.useFakeTimers();
    const { pcloudStorage } = await import('./pcloud.js');
    const { auth }: { auth: StorageAuth } = pcloudStorage(vi.fn(), TEST_ROOM);
    auth.setConfig?.('clientId', 'my-client-id');
    // Simulate a blocked popup / an SDK that never fires either callback.
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
