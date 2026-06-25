// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  localCacheEnabled,
  setLocalCacheEnabled,
  cacheDbName,
  rememberCachedRoom,
  clearLocalCache,
} from './cache.js';

beforeEach(() => localStorage.clear());

describe('local cache preferences', () => {
  it('defaults to enabled', () => {
    expect(localCacheEnabled()).toBe(true);
  });

  it('persists the disabled state', () => {
    setLocalCacheEnabled(false);
    expect(localCacheEnabled()).toBe(false);
  });

  it('can be re-enabled', () => {
    setLocalCacheEnabled(false);
    setLocalCacheEnabled(true);
    expect(localCacheEnabled()).toBe(true);
  });

  it('namespaces the IndexedDB name', () => {
    expect(cacheDbName('my-room')).toBe('copad:my-room');
  });

  it('remembers cached rooms without duplicates and clears them', async () => {
    rememberCachedRoom('a');
    rememberCachedRoom('b');
    rememberCachedRoom('a');
    expect(JSON.parse(localStorage.getItem('copad:cachedRooms')!)).toEqual(['a', 'b']);

    await clearLocalCache();
    expect(localStorage.getItem('copad:cachedRooms')).toBeNull();
  });
});
