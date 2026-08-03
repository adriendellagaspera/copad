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
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID() as BrowserId;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') as BrowserId;
  }
  throw new Error('Copad: no CSPRNG available (crypto.getRandomValues missing) — cannot mint a browser id.');
}

/** This browser's id, minting and persisting one on first use. */
export function browserId(): BrowserId {
  const existing = store.read();
  if (existing) return existing;
  const fresh = mint();
  store.write(fresh);
  return fresh;
}
