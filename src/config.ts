import { storageKey, type StorageKey } from './persistence/local.js';

// Kept in sync at build time with index.html's theme script by vite.config.ts's inject-app-namespace.
export const APP_NAMESPACE = import.meta.env.VITE_APP_NAMESPACE?.trim() || 'copad';

export const NS_PREFIX = `${APP_NAMESPACE}:`;

export function nsKey(suffix: string): StorageKey {
  return storageKey(`${NS_PREFIX}${suffix}`);
}
