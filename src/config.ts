/**
 * App-global configuration constants. Values that aren't owned by a single
 * vertical live here; per-vertical constants live in that vertical's own
 * `constants.ts` (or `config.ts`) module. Centralizing them keeps magic
 * literals out of business logic and gives every value one obvious home.
 */

import { storageKey, type StorageKey } from './persistence/local.js';

/**
 * The app's storage namespace — the prefix on the browser-local keys the app
 * owns under it (the `copad:` theme + local-cache entries and IndexedDB names).
 *
 * Overridable via `VITE_APP_NAMESPACE` so two deployments sharing an origin can
 * isolate their state. The no-flash theme script inlined in `index.html` can't
 * read env at runtime, so it's kept in sync at *build* time by the
 * `inject-app-namespace` plugin in `vite.config.ts` (same `copad` default).
 *
 * Note: changing this on a live deployment orphans existing `copad:`-namespaced
 * state — set it once, at deploy time.
 */
export const APP_NAMESPACE = import.meta.env.VITE_APP_NAMESPACE?.trim() || 'copad';

/** The namespace prefix, e.g. `copad:`. */
export const NS_PREFIX = `${APP_NAMESPACE}:`;

/** Build an app-namespaced {@link StorageKey} — e.g. `nsKey('theme')` → `copad:theme`. */
export function nsKey(suffix: string): StorageKey {
  return storageKey(`${NS_PREFIX}${suffix}`);
}
