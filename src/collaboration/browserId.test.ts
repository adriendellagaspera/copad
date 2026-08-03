import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

beforeEach(() => {
  store.clear();
  vi.resetModules();
});

describe('browserId', () => {
  it('mints via crypto.randomUUID when available', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1234' });
    const { browserId } = await import('./browserId.js');
    expect(browserId()).toBe('uuid-1234');
  });

  it('falls back to crypto.getRandomValues, never Math.random', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        arr.fill(0xab);
        return arr;
      },
    });
    const randomSpy = vi.spyOn(Math, 'random');
    const { browserId } = await import('./browserId.js');
    const id = browserId();
    expect(id).toBe('ab'.repeat(16));
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it('throws when no CSPRNG is available at all', async () => {
    vi.stubGlobal('crypto', {});
    const { browserId } = await import('./browserId.js');
    expect(() => browserId()).toThrow(/CSPRNG/);
  });

  it('persists and reuses the minted id', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-stable' });
    const { browserId } = await import('./browserId.js');
    const first = browserId();
    const second = browserId();
    expect(first).toBe(second);
  });
});
