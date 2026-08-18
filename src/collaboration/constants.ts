import type { SignalingUrl, RoomId } from './types.js';
import { nsKey, NS_PREFIX } from '../config.js';
import { storageKey, type StorageKey } from '../persistence/local.js';
import type { Milliseconds } from '../time.js';

export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '']);

/** Only sanctioned place to construct this URL brand as a literal. */
export const DEFAULT_DEV_SIGNALING = 'ws://localhost:4444' as SignalingUrl;

export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

/** Keeps hosts that sleep on idle (Render free tier, ~15 min) warm. */
const rawKeepalive = Number(import.meta.env.VITE_SIGNALING_KEEPALIVE_MS);
export const SIGNALING_KEEPALIVE_MS = (
  Number.isInteger(rawKeepalive) && rawKeepalive > 0 ? rawKeepalive : 4 * 60_000
) as Milliseconds;

export const SIGNALING_KEEPALIVE_TIMEOUT_MS = 10_000 as Milliseconds;

/** Also gates startup: the first connection waits this long for TURN creds. */
const rawIceTimeout = Number(import.meta.env.VITE_ICE_FETCH_TIMEOUT_MS);
export const ICE_FETCH_TIMEOUT_MS = (
  Number.isInteger(rawIceTimeout) && rawIceTimeout > 0 ? rawIceTimeout : 5_000
) as Milliseconds;

const rawConnectTimeout = Number(import.meta.env.VITE_CONNECT_TIMEOUT_MS);
export const CONNECT_TIMEOUT_MS = (
  Number.isInteger(rawConnectTimeout) && rawConnectTimeout > 0 ? rawConnectTimeout : 8_000
) as Milliseconds;

export const KEY_LOCAL_CACHE = nsKey('localCache');
export const KEY_CACHED_ROOMS = nsKey('cachedRooms');
export const KEY_STORAGE_INTRO_SEEN = nsKey('storageIntroSeen');
export const KEY_ROOM_HISTORY = nsKey('roomHistory');
export const ROOM_HISTORY_LIMIT = 50;

export const CACHE_DB_PREFIX = NS_PREFIX;
export const ENC_CACHE_DB_PREFIX = `${NS_PREFIX}enc:`;

/** Short because the hub pushes present peers' awareness once on connect, not on a poll. */
export const PRESENCE_PROBE_SETTLE_MS = 500 as Milliseconds;

export const roomPasswordKey = (room: RoomId): StorageKey =>
  storageKey(`collab.room-password.${room}`);

export const roomEncryptedKey = (room: RoomId): StorageKey =>
  storageKey(`collab.room-encrypted.${room}`);

export const roomOpenKey = (room: RoomId): StorageKey =>
  storageKey(`collab.room-open.${room}`);
