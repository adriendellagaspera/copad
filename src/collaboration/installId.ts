/**
 * A stable, random identifier for this browser profile. It distinguishes one
 * user's backend from another's when scoping persistence (e.g. two different
 * Dropbox accounts writing the same filename in one room resolve to *different*
 * files, so both must autosave — see `persistTargetKey` in `leader.ts`), without
 * ever revealing any account identity: only a hash of it travels in awareness.
 *
 * Generated once and remembered in localStorage under the app namespace.
 */

import { nsKey } from '../config.js';
import { localStore } from '../persistence/local.js';

/** Opaque per-browser id. Branded so a raw string can't stand in for one. */
export type InstallId = string & { readonly _brand: 'InstallId' };

const store = localStore<InstallId | null>(
  nsKey('install-id'),
  (raw) => (raw && raw.trim() ? (raw.trim() as InstallId) : null),
  (id) => id,
);

function mint(): InstallId {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return rand as InstallId;
}

/** This browser's install id, minting and persisting one on first use. */
export function installId(): InstallId {
  const existing = store.read();
  if (existing) return existing;
  const fresh = mint();
  store.write(fresh);
  return fresh;
}
