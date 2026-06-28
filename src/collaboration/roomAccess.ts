import type { RoomId } from './types.js';
import { parseRoomCredential } from './parse.js';
import { localStore } from '../persistence/local.js';
import { roomPasswordKey } from './constants.js';

/** The four room-access strategies, parsed from `VITE_ROOM_AUTH` at the env
 *  boundary. The union carries the invariant: once you hold a `RoomAccess`,
 *  the mode is already validated — no further string-checking needed. */
export const RoomAccessMode = {
  Public: 'public',
  SitePassword: 'site-password',
  RoomPassword: 'room-password',
  SecretLink: 'secret-link',
} as const;
export type RoomAccessMode = (typeof RoomAccessMode)[keyof typeof RoomAccessMode];

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
  return { mode: RoomAccessMode.Public, credential: () => null };
}

/**
 * A single password for every room in the deployment, sourced from the
 * `VITE_ROOM_PASSWORD` env var. Whitespace-only values are treated as absent.
 */
export function sitePassword(envPassword: string): RoomAccess {
  const cred = parseRoomCredential(envPassword);
  return { mode: RoomAccessMode.SitePassword, credential: () => cred };
}

/** Per-room password store — credential parsing and localStorage are both hidden
 *  behind read/write/clear, keyed by room. Whitespace-only values clear the entry. */
const roomPasswordStore = (room: RoomId) =>
  localStore<RoomCredential | null>(
    roomPasswordKey(room),
    parseRoomCredential,
    (cred) => (cred && cred.trim() ? cred : null),
  );

/**
 * Each room has its own password, typed by the user and remembered in
 * `localStorage`. Call {@link setRoomPassword} from the UI to persist one.
 */
export function roomPassword(): RoomAccess {
  return {
    mode: RoomAccessMode.RoomPassword,
    credential: (room) => roomPasswordStore(room).read(),
  };
}

/** Persist a per-room password. Pass an empty string to clear it. */
export function setRoomPassword(room: RoomId, password: string): void {
  roomPasswordStore(room).write(password as RoomCredential);
}

/** Remove the stored password for a room. */
export function clearRoomPassword(room: RoomId): void {
  roomPasswordStore(room).clear();
}
