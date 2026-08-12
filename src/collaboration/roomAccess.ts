import type { RoomId } from './types.js';
import { parseRoomCredential } from './parse.js';
import { localStore } from '../persistence/local.js';
import { roomPasswordKey, roomOpenKey } from './constants.js';

export const RoomAccessMode = {
  Public: 'public',
  SitePassword: 'site-password',
  RoomPassword: 'room-password',
  SecretLink: 'secret-link',
} as const;
export type RoomAccessMode = (typeof RoomAccessMode)[keyof typeof RoomAccessMode];

export type RoomCredential = string & { readonly _brand: 'RoomCredential' };

export interface RoomAccess {
  readonly mode: RoomAccessMode;
  credential(room: RoomId): RoomCredential | null;
}

export function publicAccess(): RoomAccess {
  return { mode: RoomAccessMode.Public, credential: () => null };
}

export function sitePassword(envPassword: string): RoomAccess {
  const cred = parseRoomCredential(envPassword);
  return { mode: RoomAccessMode.SitePassword, credential: () => cred };
}

const roomPasswordStore = (room: RoomId) =>
  localStore<RoomCredential | null>(
    roomPasswordKey(room),
    parseRoomCredential,
    (cred) => (cred && cred.trim() ? cred : null),
  );

export function roomPassword(): RoomAccess {
  return {
    mode: RoomAccessMode.RoomPassword,
    credential: (room) => roomPasswordStore(room).read(),
  };
}

/** An empty string clears the stored password. */
export function setRoomPassword(room: RoomId, password: string): void {
  roomPasswordStore(room).write(password as RoomCredential);
}

export function clearRoomPassword(room: RoomId): void {
  roomPasswordStore(room).clear();
}

const roomOpenStore = (room: RoomId) =>
  localStore<boolean>(
    roomOpenKey(room),
    (raw) => raw === '1',
    (open) => (open ? '1' : null),
  );

export function roomOpenedWithoutPassword(room: RoomId): boolean {
  return roomOpenStore(room).read();
}

export function setRoomOpenedWithoutPassword(room: RoomId): void {
  roomOpenStore(room).write(true);
}
