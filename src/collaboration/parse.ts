import type {
  DisplayName, CursorColor, SessionRole, PeerAwarenessState, RoomId,
  StunUrl, TurnUrl, TurnUsername, TurnCredential, FallbackTurnPolicy,
} from './types.js';
import type { RoomCredential } from './roomAccess.js';
import type { LocalCacheEnabled } from './cache.js';
import type { TurnPrefs } from './turn.js';
import { FALLBACK_NAME, FALLBACK_COLOR } from './peerDefaults.js';

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
  const role: SessionRole = obj['role'] === 'reader' ? 'reader' : 'writer';
  const canPersist = obj['canPersist'] === true;
  return { user: { name, color }, role, canPersist };
}

/** Parse a raw string from storage as a RoomId — the single cast site for RoomId from localStorage/URL. */
export function parseRoomId(raw: string | null): RoomId | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as RoomId) : null;
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
  fallback: 'openrelay',
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
    const fallback: FallbackTurnPolicy = fallbackRaw === 'none' ? 'none' : 'openrelay';

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
