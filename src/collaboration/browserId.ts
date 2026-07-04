/**
 * A stable, random identifier for this browser profile — one of many, not a
 * privileged role. It distinguishes one participant's storage from another's
 * when scoping persistence: two different browsers saving the same filename to
 * different accounts resolve to *different* files, so each must autosave its own
 * copy (see `persistTargetKey` in `leader.ts`). It never reveals any account
 * identity — only a hash of it travels in awareness — and it is deliberately the
 * same across rooms (it identifies the browser, not a room).
 *
 * Generated once and remembered in localStorage under the app namespace.
 */

import { nsKey } from '../config.js';
import { localStore } from '../persistence/local.js';

/** Opaque per-browser id. Branded so a raw string can't stand in for one. */
export type BrowserId = string & { readonly _brand: 'BrowserId' };

const store = localStore<BrowserId | null>(
  nsKey('browser-id'),
  (raw) => (raw && raw.trim() ? (raw.trim() as BrowserId) : null),
  (id) => id,
);

function mint(): BrowserId {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return rand as BrowserId;
}

/** This browser's id, minting and persisting one on first use. */
export function browserId(): BrowserId {
  const existing = store.read();
  if (existing) return existing;
  const fresh = mint();
  store.write(fresh);
  return fresh;
}
