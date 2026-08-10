// Runtime TURN configuration, persisted in localStorage. Lets a user bring their
// own TURN relay (or turn off the public default) from the Settings panel without
// a rebuild. Read by App.svelte when building the WebRTC ICE list; takes effect on
// the next reconnect. Env vars (VITE_TURN_*) remain the deployment-level default.

import { localStore } from '../persistence/local.js';
import { FallbackTurnPolicy } from './types.js';
import { nsKey } from '../config.js';
import { parseTurnPrefs } from './parse.js';
import type { TurnUrl, TurnUsername, TurnCredential } from './types.js';

export interface TurnPrefs {
  /** Validated TURN URLs from the Settings form — empty means use env/public default. */
  urls: TurnUrl[];
  /** TURN long-term credential username. */
  username: TurnUsername;
  /** TURN long-term credential secret. */
  credential: TurnCredential;
  /** Which public relay (if any) to use when no custom/env TURN is set. */
  fallback: FallbackTurnPolicy;
}

// localStorage + parsing are abstracted behind the store: callers read/write a
// typed TurnPrefs and never touch localStorage or a parser directly.
const turnStore = localStore<TurnPrefs>(nsKey('turn'), parseTurnPrefs, (p) => JSON.stringify(p));

export function getTurnPrefs(): TurnPrefs {
  return turnStore.read();
}

export function setTurnPrefs(prefs: TurnPrefs): void {
  turnStore.write(prefs);
}

/** The Settings form's TURN URL field before it parses into a `TurnUrl`. */
export type TurnUrlDraft = string & { readonly _brand: 'TurnUrlDraft' };

export const TurnRelayStatus = {
  Custom: 'custom',
  Public: 'public',
  None: 'none',
} as const;
export type TurnRelayStatus = (typeof TurnRelayStatus)[keyof typeof TurnRelayStatus];

export function turnRelayStatus(
  draft: TurnUrlDraft,
  fallback: FallbackTurnPolicy,
): TurnRelayStatus {
  if (draft.trim()) return TurnRelayStatus.Custom;
  return fallback === FallbackTurnPolicy.OpenRelay ? TurnRelayStatus.Public : TurnRelayStatus.None;
}
