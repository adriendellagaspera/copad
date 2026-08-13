// Deliberately identical across rooms: it identifies the browser, not a room.

import { nsKey } from '../config.js';
import { localStore } from '../persistence/local.js';

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

export function browserId(): BrowserId {
  const existing = store.read();
  if (existing) return existing;
  const fresh = mint();
  store.write(fresh);
  return fresh;
}
