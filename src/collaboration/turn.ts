// User-level override of the VITE_TURN_* deployment default; takes effect on
// the next reconnect.

import { localStore } from '../persistence/local.js';
import { FallbackTurnPolicy } from './types.js';
import { nsKey } from '../config.js';
import { parseTurnPrefs } from './parse.js';
import type { TurnUrl, TurnUsername, TurnCredential } from './types.js';

export interface TurnPrefs {
  /** Empty falls back to the env/public default. */
  urls: TurnUrl[];
  username: TurnUsername;
  credential: TurnCredential;
  fallback: FallbackTurnPolicy;
}

const turnStore = localStore<TurnPrefs>(nsKey('turn'), parseTurnPrefs, (p) => JSON.stringify(p));

export function getTurnPrefs(): TurnPrefs {
  return turnStore.read();
}

export function setTurnPrefs(prefs: TurnPrefs): void {
  turnStore.write(prefs);
}

/** Unparsed form input, not yet a `TurnUrl`. */
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
