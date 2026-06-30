/**
 * Collaboration-vertical constants: connection defaults and the browser-local
 * keys this vertical persists under. Centralized here so no endpoint default,
 * landing room, or storage key is buried in business logic — `config.ts` reads
 * these for its resolvers, and `cache.ts` / `roomAccess.ts` for their keys.
 */

import type { SignalingUrl, RoomId } from './types.js';
import { nsKey, NS_PREFIX } from '../config.js';
import { storageKey, type StorageKey } from '../persistence/local.js';

// ── Connection defaults ───────────────────────────────────────────────────────

/** Hostnames that mean "this is local dev", where `ws://localhost` is reasonable. */
export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '']);

/** Dev-only signaling fallback — the single sanctioned brand entry for the default. */
export const DEFAULT_DEV_SIGNALING = 'ws://localhost:4444' as SignalingUrl;

/** Public STUN server used when `VITE_STUN_URL` is unset (set it empty to disable). */
export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

/** Landing room when neither `?room=` nor `VITE_DEFAULT_ROOM` provides one. */
export const DEFAULT_ROOM_NAME = 'copad-demo' as RoomId;

// ── Browser-local keys ────────────────────────────────────────────────────────

/** Local-document-cache on/off preference. */
export const KEY_LOCAL_CACHE = nsKey('localCache');
/** Index of rooms with a local cache, so "clear" works without `indexedDB.databases()`. */
export const KEY_CACHED_ROOMS = nsKey('cachedRooms');
/** Rooms the user has recently visited, powering the room switcher (anti-loss). */
export const KEY_RECENT_ROOMS = nsKey('recentRooms');

/** How many recently-visited rooms to remember in the switcher. */
export const RECENT_ROOMS_MAX = 12;

/** IndexedDB database-name prefix — shares the app namespace (`copad:`). */
export const CACHE_DB_PREFIX = NS_PREFIX;

/** Per-room password key for the room-password access strategy. */
export const roomPasswordKey = (room: RoomId): StorageKey =>
  storageKey(`collab.room-password.${room}`);
