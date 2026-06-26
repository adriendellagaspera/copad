import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configStore } from './config.js';
import type { StorageId } from './types.js';

const TEST_ID = 'demo' as StorageId;

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => localStorageMock.clear());

describe('configStore', () => {
  it('exposes its fields without the internal env property', () => {
    const cfg = configStore(TEST_ID, [{ name: 'key', label: 'Key', env: 'x' }]);
    expect(cfg.fields).toEqual([{ name: 'key', label: 'Key' }]);
  });

  it('persists and reads a value via localStorage', () => {
    const cfg = configStore(TEST_ID, [{ name: 'key', label: 'Key' }]);
    expect(cfg.config('key')).toBe('');
    cfg.setConfig('key', '  abc  ');
    expect(cfg.config('key')).toBe('abc');
    expect(localStorage.getItem('storage.demo.key')).toBe('abc');
  });

  it('clearing a value removes it from storage', () => {
    const cfg = configStore(TEST_ID, [{ name: 'key', label: 'Key' }]);
    cfg.setConfig('key', 'abc');
    cfg.setConfig('key', '');
    expect(cfg.config('key')).toBe('');
    expect(localStorage.getItem('storage.demo.key')).toBeNull();
  });

  it('env value locks the field and wins over saved values', () => {
    localStorage.setItem('storage.demo.key', 'saved');
    const cfg = configStore(TEST_ID, [{ name: 'key', label: 'Key', env: 'fromEnv' }]);
    expect(cfg.config('key')).toBe('fromEnv');
    expect(cfg.configLocked('key')).toBe(true);
    cfg.setConfig('key', 'ignored'); // locked — no-op
    expect(cfg.config('key')).toBe('fromEnv');
  });

  it('configured() is true only when every field has a value', () => {
    const cfg = configStore(TEST_ID, [
      { name: 'a', label: 'A' },
      { name: 'b', label: 'B' },
    ]);
    expect(cfg.configured()).toBe(false);
    cfg.setConfig('a', '1');
    expect(cfg.configured()).toBe(false);
    cfg.setConfig('b', '2');
    expect(cfg.configured()).toBe(true);
  });
});
