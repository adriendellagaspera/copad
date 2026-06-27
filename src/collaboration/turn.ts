// Runtime TURN configuration, persisted in localStorage. Lets a user bring their
// own TURN relay (or turn off the public default) from the Settings panel without
// a rebuild. Read by App.svelte when building the WebRTC ICE list; takes effect on
// the next reconnect. Env vars (VITE_TURN_*) remain the deployment-level default.

import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';
import { parseTurnPrefs } from './parse.js';

export interface TurnPrefs {
  /** Custom TURN url(s), comma-separated. Empty = use env / public default.
   *  Stays a raw string here (user form input); branded to TurnUrl in resolveIceServers. */
  url: string;
  username: string;
  credential: string;
  /** Use the bundled public relay when no custom/env TURN is set. */
  useDefault: boolean;
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
