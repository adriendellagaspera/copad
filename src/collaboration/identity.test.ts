import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CursorColor } from './types.js';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const PALETTE = ['#e11d48', '#7c3aed', '#0891b2'] as CursorColor[];

beforeEach(() => {
  store.clear();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe('storedName', () => {
  it('defaults to Anonymous on first visit', async () => {
    const { storedName } = await import('./identity.js');
    expect(storedName()).toBe('Anonymous');
  });

  it('degrades a corrupt or empty stored value to the default', async () => {
    store.set('copad:identity-name', '   ');
    const { storedName } = await import('./identity.js');
    expect(storedName()).toBe('Anonymous');
  });

  it('degrades to the default when storage throws (private mode)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    const { storedName, rememberName } = await import('./identity.js');
    expect(storedName()).toBe('Anonymous');
    expect(() => rememberName('Ada')).not.toThrow();
  });
});

describe('rememberName', () => {
  it('round-trips a chosen name across reads', async () => {
    const { storedName, rememberName } = await import('./identity.js');
    rememberName('Ada Lovelace');
    expect(storedName()).toBe('Ada Lovelace');
  });

  it('trims the typed name before persisting', async () => {
    const { storedName, rememberName } = await import('./identity.js');
    rememberName('  Grace  ');
    expect(storedName()).toBe('Grace');
  });

  it('clearing the field back to empty degrades to the default', async () => {
    const { storedName, rememberName } = await import('./identity.js');
    rememberName('Ada');
    rememberName('');
    expect(storedName()).toBe('Anonymous');
  });

  it('persists under the namespaced key so a fresh module read sees it', async () => {
    const { rememberName } = await import('./identity.js');
    rememberName('Ada');
    vi.resetModules();
    const { storedName } = await import('./identity.js');
    expect(storedName()).toBe('Ada');
  });
});

describe('storedColor', () => {
  it('picks from the palette on the clock formula when nothing is stored', async () => {
    vi.stubGlobal('Date', { now: () => 7_000 });
    const { storedColor } = await import('./identity.js');
    expect(storedColor(PALETTE)).toBe(PALETTE[7 % PALETTE.length]);
  });

  it('round-trips a chosen colour across reads', async () => {
    const { storedColor, rememberColor } = await import('./identity.js');
    rememberColor(PALETTE[1], PALETTE);
    expect(storedColor(PALETTE)).toBe(PALETTE[1]);
  });

  it('degrades an empty stored value to a fresh palette pick', async () => {
    store.set('copad:identity-color', '');
    vi.stubGlobal('Date', { now: () => 0 });
    const { storedColor } = await import('./identity.js');
    expect(storedColor(PALETTE)).toBe(PALETTE[0]);
  });

  it('degrades a colour outside the current palette to a fresh pick', async () => {
    store.set('copad:identity-color', '#ffffff');
    vi.stubGlobal('Date', { now: () => 0 });
    const { storedColor } = await import('./identity.js');
    expect(storedColor(PALETTE)).toBe(PALETTE[0]);
  });

  it('degrades to a fresh palette pick when storage throws (private mode)', async () => {
    vi.stubGlobal('Date', { now: () => 0 });
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    const { storedColor, rememberColor } = await import('./identity.js');
    expect(storedColor(PALETTE)).toBe(PALETTE[0]);
    expect(() => rememberColor(PALETTE[1], PALETTE)).not.toThrow();
  });
});
