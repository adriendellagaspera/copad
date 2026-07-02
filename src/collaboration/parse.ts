import type {
  DisplayName, CursorColor, PeerAwarenessState, PersistTarget, RoomId, RoomName, RecentRoom,
  SignalingUrl, WebsocketUrl,
  StunUrl, TurnUrl, TurnUsername, TurnCredential, IceServer, IceServersUrl,
} from './types.js';
import { SessionRole, FallbackTurnPolicy } from './types.js';
import type { RoomCredential } from './roomAccess.js';
import type { LocalCacheEnabled } from './cache.js';
import type { TurnPrefs } from './turn.js';
import { FALLBACK_NAME, FALLBACK_COLOR } from './peerDefaults.js';

/** ws:// or wss:// — the only schemes y-webrtc / y-websocket understand. */
const WS_URL = /^wss?:\/\/\S+$/i;

/** Single cast site for SignalingUrl. */
export function parseSignalingUrl(raw: string): SignalingUrl | null {
  return WS_URL.test(raw) ? (raw as SignalingUrl) : null;
}

/** Single cast site for WebsocketUrl. */
export function parseWebsocketUrl(raw: string): WebsocketUrl | null {
  return WS_URL.test(raw) ? (raw as WebsocketUrl) : null;
}

/** stun: / turn: / turns: — the ICE URL schemes WebRTC understands. */
const ICE_URL = /^(?:stun|turns?):\S+$/i;

/** Single cast site for StunUrl — call from resolveIceServers or any ICE config parser. */
export function parseStunUrl(raw: string): StunUrl | null {
  return ICE_URL.test(raw) ? (raw as StunUrl) : null;
}

/** Single cast site for TurnUrl — call from resolveIceServers or any ICE config parser. */
export function parseTurnUrl(raw: string): TurnUrl | null {
  return ICE_URL.test(raw) ? (raw as TurnUrl) : null;
}

/** Cast site for TurnUsername from user form input. Any non-null string is accepted;
 *  validation (required, format) is the caller's responsibility at the UI layer. */
export function parseTurnUsername(raw: string): TurnUsername {
  return raw as TurnUsername;
}

/** Cast site for TurnCredential from user form input. */
export function parseTurnCredential(raw: string): TurnCredential {
  return raw as TurnCredential;
}

/** http(s):// endpoint that mints ICE servers. Single cast site for IceServersUrl. */
const HTTP_URL = /^https?:\/\/\S+$/i;
export function parseIceServersUrl(raw: string): IceServersUrl | null {
  return HTTP_URL.test(raw) ? (raw as IceServersUrl) : null;
}

/** Classify one ICE URL string by scheme, routing it through the matching cast
 *  site so a mixed `urls` array becomes properly branded `(StunUrl | TurnUrl)`. */
function parseIceUrl(raw: string): StunUrl | TurnUrl | null {
  return /^stun:/i.test(raw.trim()) ? parseStunUrl(raw.trim()) : parseTurnUrl(raw.trim());
}

/**
 * Parse an ICE-servers HTTP response (`{ iceServers: [{ urls, username?, credential? }] }`,
 * the shape returned by Cloudflare's TURN credentials API and most managed relays)
 * into branded {@link IceServer}s. Every field access is guarded and malformed
 * entries/urls are dropped, so a bad or partial response yields `[]` rather than
 * throwing. The single IO-boundary parse site for fetched ICE config. `urls` may
 * be a string or an array of strings per the RTCIceServer shape.
 */
export function parseIceServersResponse(raw: unknown): IceServer[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const entries = (raw as Record<string, unknown>)['iceServers'];
  if (!Array.isArray(entries)) return [];

  const servers: IceServer[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const o = entry as Record<string, unknown>;
    const rawUrls = Array.isArray(o['urls'])
      ? o['urls']
      : typeof o['urls'] === 'string'
        ? [o['urls']]
        : [];
    const urls = rawUrls
      .filter((u): u is string => typeof u === 'string')
      .map(parseIceUrl)
      .filter((u): u is StunUrl | TurnUrl => u !== null);
    if (urls.length === 0) continue;
    servers.push({
      urls,
      ...(typeof o['username'] === 'string' ? { username: parseTurnUsername(o['username']) } : {}),
      ...(typeof o['credential'] === 'string' ? { credential: parseTurnCredential(o['credential']) } : {}),
    });
  }
  return servers;
}

/**
 * Parse an unknown awareness state value arriving from a peer browser.
 * All field access is guarded — malformed peer data produces safe fallbacks.
 * This is the single cast site for DisplayName and CursorColor from network data.
 */
export function parsePeerAwarenessState(raw: unknown): PeerAwarenessState {
  const obj = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};
  const user = (typeof obj['user'] === 'object' && obj['user'] !== null)
    ? obj['user'] as Record<string, unknown>
    : {};
  const nameRaw = user['name'];
  const colorRaw = user['color'];
  const name: DisplayName = (typeof nameRaw === 'string' && nameRaw.trim())
    ? nameRaw.trim() as DisplayName
    : FALLBACK_NAME;
  const color: CursorColor = (typeof colorRaw === 'string' && /^#[0-9a-fA-F]{6}$/.test(colorRaw))
    ? colorRaw as CursorColor
    : FALLBACK_COLOR;
  const role: SessionRole = obj['role'] === SessionRole.Reader ? SessionRole.Reader : SessionRole.Writer;
  const canPersist = obj['canPersist'] === true;
  const targetRaw = obj['persistTarget'];
  const persistTarget: PersistTarget | undefined =
    typeof targetRaw === 'string' && targetRaw ? (targetRaw as PersistTarget) : undefined;
  return { user: { name, color }, role, canPersist, ...(persistTarget ? { persistTarget } : {}) };
}

/** Parse a raw string from storage as a RoomId — the single cast site for RoomId from localStorage/URL. */
export function parseRoomId(raw: string | null): RoomId | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as RoomId) : null;
}

/** Parse a raw string as a RoomName — the single cast site for RoomName, used
 *  for the shared Y.Doc value and for user input from the rename field. Empty /
 *  whitespace-only names become null (the room falls back to showing its id). */
export function parseRoomName(raw: string | null): RoomName | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as RoomName) : null;
}

/** Parse the JSON-encoded recent-rooms list from localStorage into typed
 *  {@link RecentRoom}s, dropping any malformed entry. Single narrowing site. */
export function parseRecentRooms(raw: string | null): RecentRoom[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const out: RecentRoom[] = [];
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const o = entry as Record<string, unknown>;
      const id = parseRoomId(typeof o['id'] === 'string' ? o['id'] : null);
      if (!id) continue;
      const name = parseRoomName(typeof o['name'] === 'string' ? o['name'] : null);
      const visitedAt = typeof o['visitedAt'] === 'number' ? o['visitedAt'] : 0;
      out.push({ id, name, visitedAt });
    }
    return out;
  } catch {
    return [];
  }
}

/** Parse a stored string as a RoomCredential — the single cast site for RoomCredential from localStorage/URL. */
export function parseRoomCredential(raw: string | null): RoomCredential | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as RoomCredential) : null;
}

/** Parse the local-cache on/off flag — defaults to enabled (anything but '0'). */
export function parseLocalCacheEnabled(raw: string | null): LocalCacheEnabled {
  return (raw !== '0') as LocalCacheEnabled;
}

/** Parse a JSON-encoded room list from localStorage into typed RoomIds. */
export function parseRoomList(raw: string | null): RoomId[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((r): r is string => typeof r === 'string')
      .map(parseRoomId)
      .filter((r): r is RoomId => r !== null);
  } catch {
    return [];
  }
}

/** Runtime TURN prefs when none are stored (or the stored value is malformed). */
const TURN_PREFS_FALLBACK: TurnPrefs = {
  urls: [],
  username: parseTurnUsername(''),
  credential: parseTurnCredential(''),
  fallback: FallbackTurnPolicy.OpenRelay,
};

/** Parse persisted runtime TURN prefs from localStorage JSON — the single
 *  narrowing site, filling any missing/invalid field from the defaults. */
export function parseTurnPrefs(raw: string | null): TurnPrefs {
  if (!raw) return { ...TURN_PREFS_FALLBACK };
  try {
    const obj: unknown = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null) return { ...TURN_PREFS_FALLBACK };
    const o = obj as Record<string, unknown>;

    const rawUrls = o['urls'];
    const urls: TurnUrl[] = Array.isArray(rawUrls)
      ? rawUrls
          .filter((u): u is string => typeof u === 'string')
          .map(parseTurnUrl)
          .filter((u): u is TurnUrl => u !== null)
      : TURN_PREFS_FALLBACK.urls;

    const fallbackRaw = o['fallback'];
    const fallback: FallbackTurnPolicy =
      fallbackRaw === FallbackTurnPolicy.None ? FallbackTurnPolicy.None : FallbackTurnPolicy.OpenRelay;

    return {
      urls,
      username: parseTurnUsername(typeof o['username'] === 'string' ? o['username'] : ''),
      credential: parseTurnCredential(typeof o['credential'] === 'string' ? o['credential'] : ''),
      fallback,
    };
  } catch {
    return { ...TURN_PREFS_FALLBACK };
  }
}
