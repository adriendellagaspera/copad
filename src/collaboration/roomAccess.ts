import type { RoomId } from './types.js';
import { parseRoomCredential } from './parse.js';

/** The four room-access strategies, parsed from `VITE_ROOM_AUTH` at the env
 *  boundary. The union carries the invariant: once you hold a `RoomAccess`,
 *  the mode is already validated — no further string-checking needed. */
export type RoomAccessMode =
  | 'public'
  | 'site-password'
  | 'room-password'
  | 'secret-link';

/** A credential that has passed the room-access boundary — sourced from a
 *  trusted store (env var, localStorage, or URL hash fragment). Distinct from
 *  an arbitrary string so callers can't accidentally pass raw user input. */
export type RoomCredential = string & { readonly _brand: 'RoomCredential' };

export interface RoomAccess {
  readonly mode: RoomAccessMode;
  /**
   * Returns the credential for this room, or `null` when none is available
   * (no password entered yet, no key in the URL, empty env var).
   */
  credential(room: RoomId): RoomCredential | null;
}

// ── Adapters ──────────────────────────────────────────────────────────────────

/** No gate — anyone with the URL may join. */
export function publicAccess(): RoomAccess {
  return { mode: 'public', credential: () => null };
}

/**
 * A single password for every room in the deployment, sourced from the
 * `VITE_ROOM_PASSWORD` env var. Whitespace-only values are treated as absent.
 */
export function sitePassword(envPassword: string): RoomAccess {
  const cred = parseRoomCredential(envPassword);
  return { mode: 'site-password', credential: () => cred };
}

type RoomPasswordKey = `collab.room-password.${RoomId}`;
const roomPasswordKey = (room: RoomId): RoomPasswordKey =>
  `collab.room-password.${room}`;

/**
 * Each room has its own password, typed by the user and remembered in
 * `localStorage`. Call {@link setRoomPassword} from the UI to persist one.
 */
export function roomPassword(): RoomAccess {
  return {
    mode: 'room-password',
    credential: (room) => parseRoomCredential(localStorage.getItem(roomPasswordKey(room))),
  };
}

/** Persist a per-room password. Pass an empty string to clear it. */
export function setRoomPassword(room: RoomId, password: string): void {
  if (password) {
    localStorage.setItem(roomPasswordKey(room), password);
  } else {
    localStorage.removeItem(roomPasswordKey(room));
  }
}

/** Remove the stored password for a room. */
export function clearRoomPassword(room: RoomId): void {
  localStorage.removeItem(roomPasswordKey(room));
}
