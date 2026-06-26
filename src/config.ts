/**
 * App-global configuration constants. Values that aren't owned by a single
 * vertical live here; per-vertical constants live in that vertical's own
 * `constants.ts` (or `config.ts`) module. Centralizing them keeps magic
 * literals out of business logic and gives every value one obvious home.
 */

import { storageKey, type StorageKey } from './persistence/local.js';

/**
 * The app's storage namespace — the prefix on every browser-local key the app
 * owns (localStorage entries and IndexedDB database names). This is app
 * *identity*, not a deployment knob: the no-flash theme script inlined in
 * `index.html` hardcodes the same `copad:` prefix and can't read env vars, so
 * the namespace must stay a fixed constant rather than an env override.
 */
export const APP_NAMESPACE = 'copad' as const;

/** The `copad:` prefix as a literal type, so names derived from it stay precise. */
export const NS_PREFIX = `${APP_NAMESPACE}:` as const;

/** Build an app-namespaced {@link StorageKey} — e.g. `nsKey('theme')` → `copad:theme`. */
export function nsKey(suffix: string): StorageKey {
  return storageKey(`${NS_PREFIX}${suffix}`);
}
