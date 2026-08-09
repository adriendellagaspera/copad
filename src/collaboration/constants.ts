import type { SignalingUrl, RoomId } from './types.js';
import { nsKey, NS_PREFIX } from '../config.js';
import { storageKey, type StorageKey } from '../persistence/local.js';
import type { Milliseconds } from '../time.js';

// ── Connection defaults ───────────────────────────────────────────────────────

export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '']);

/** Only sanctioned place to construct this URL brand as a literal. */
export const DEFAULT_DEV_SIGNALING = 'ws://localhost:4444' as SignalingUrl;

export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

export const DEFAULT_ROOM_NAME = 'copad-demo' as RoomId;

/** Pings each signaling server periodically so hosts that sleep on idle (e.g.
 *  Render free tier, ~15min) stay warm. Override via VITE_SIGNALING_KEEPALIVE_MS. */
const rawKeepalive = Number(import.meta.env.VITE_SIGNALING_KEEPALIVE_MS);
export const SIGNALING_KEEPALIVE_MS = (
  Number.isInteger(rawKeepalive) && rawKeepalive > 0 ? rawKeepalive : 4 * 60_000
) as Milliseconds;

export const SIGNALING_KEEPALIVE_TIMEOUT_MS = 10_000 as Milliseconds;

/** Timeout for VITE_ICE_SERVERS_URL; also gates startup — the first connection
 *  waits up to this long for TURN creds before connecting without them. */
const rawIceTimeout = Number(import.meta.env.VITE_ICE_FETCH_TIMEOUT_MS);
export const ICE_FETCH_TIMEOUT_MS = (
  Number.isInteger(rawIceTimeout) && rawIceTimeout > 0 ? rawIceTimeout : 5_000
) as Milliseconds;

/** How long a transport may sit unattached before `ConnStatus.Unreachable`
 *  fires instead of "Connecting…" forever. Resets on manual reconnect or the
 *  browser regaining network. Override via VITE_CONNECT_TIMEOUT_MS. */
const rawConnectTimeout = Number(import.meta.env.VITE_CONNECT_TIMEOUT_MS);
export const CONNECT_TIMEOUT_MS = (
  Number.isInteger(rawConnectTimeout) && rawConnectTimeout > 0 ? rawConnectTimeout : 8_000
) as Milliseconds;

// ── Browser-local keys ────────────────────────────────────────────────────────

export const KEY_LOCAL_CACHE = nsKey('localCache');
/** Avoids needing `indexedDB.databases()` to know what to clear. */
export const KEY_CACHED_ROOMS = nsKey('cachedRooms');
/** Global, not per-room; localStorage's origin scoping means it re-shows once
 *  per deployment. */
export const KEY_COLLAB_UNAVAILABLE_SEEN = nsKey('collabUnavailableSeen');

export const CACHE_DB_PREFIX = NS_PREFIX;
export const ENC_CACHE_DB_PREFIX = `${NS_PREFIX}enc:`;

/** Grace window after a hub presence probe's socket opens before concluding
 *  `empty`. The stock server pushes present peers' awareness state once, in
 *  the reply that opens the connection — not a poll, so there's no roster to
 *  wait out. */
export const PRESENCE_PROBE_SETTLE_MS = 500 as Milliseconds;

export const roomPasswordKey = (room: RoomId): StorageKey =>
  storageKey(`collab.room-password.${room}`);

export const roomEncryptedKey = (room: RoomId): StorageKey =>
  storageKey(`collab.room-encrypted.${room}`);

export const roomOpenKey = (room: RoomId): StorageKey =>
  storageKey(`collab.room-open.${room}`);
