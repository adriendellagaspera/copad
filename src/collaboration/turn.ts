// Runtime TURN configuration, persisted in localStorage. Lets a user bring their
// own TURN relay (or turn off the public default) from the Settings panel without
// a rebuild. Read by App.svelte when building the WebRTC ICE list; takes effect on
// the next reconnect. Env vars (VITE_TURN_*) remain the deployment-level default.

const KEY = 'copad:turn';

export interface TurnPrefs {
  /** Custom TURN url(s), comma-separated. Empty = use env / public default. */
  url: string;
  username: string;
  credential: string;
  /** Use the bundled public relay when no custom/env TURN is set. */
  useDefault: boolean;
}

const EMPTY: TurnPrefs = { url: '', username: '', credential: '', useDefault: true };

export function getTurnPrefs(): TurnPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...EMPTY };
}

export function setTurnPrefs(prefs: TurnPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
