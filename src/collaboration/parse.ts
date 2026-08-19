import type {
  DisplayName, CursorColor, ClientId, PeerAwarenessState, PersistTarget, RoomId, RoomName,
  SignalingUrl, WebsocketUrl,
  StunUrl, TurnUrl, TurnUsername, TurnCredential, IceServer, IceServersUrl,
} from './types.js';
import { SessionRole, FallbackTurnPolicy } from './types.js';
import type { BrowserId } from './browserId.js';
import type { SelfProbeMarker } from './selfProbeMarker.js';
import type { RoomCredential } from './roomAccess.js';
import type { KeyFingerprint } from './roomCrypto.js';
import type { LocalCacheEnabled } from './cache.js';
import type { TurnPrefs } from './turn.js';
import { FALLBACK_NAME, FALLBACK_COLOR } from './peerDefaults.js';

const WS_URL = /^wss?:\/\/\S+$/i;

export function parseSignalingUrl(raw: string): SignalingUrl | null {
  return WS_URL.test(raw) ? (raw as SignalingUrl) : null;
}

export function parseWebsocketUrl(raw: string): WebsocketUrl | null {
  return WS_URL.test(raw) ? (raw as WebsocketUrl) : null;
}

const ICE_URL = /^(?:stun|turns?):\S+$/i;

export function parseStunUrl(raw: string): StunUrl | null {
  return ICE_URL.test(raw) ? (raw as StunUrl) : null;
}

export function parseTurnUrl(raw: string): TurnUrl | null {
  return ICE_URL.test(raw) ? (raw as TurnUrl) : null;
}

export function parseTurnUsername(raw: string): TurnUsername {
  return raw as TurnUsername;
}

export function parseTurnCredential(raw: string): TurnCredential {
  return raw as TurnCredential;
}

const HTTP_URL = /^https?:\/\/\S+$/i;
export function parseIceServersUrl(raw: string): IceServersUrl | null {
  return HTTP_URL.test(raw) ? (raw as IceServersUrl) : null;
}

function parseIceUrl(raw: string): StunUrl | TurnUrl | null {
  return /^stun:/i.test(raw.trim()) ? parseStunUrl(raw.trim()) : parseTurnUrl(raw.trim());
}

// Matches Cloudflare's TURN credentials API shape: { iceServers: [{ urls, username?, credential? }] }.
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
  const browserIdRaw = obj['browserId'];
  const browserId: BrowserId | undefined =
    typeof browserIdRaw === 'string' && browserIdRaw ? (browserIdRaw as BrowserId) : undefined;
  const selfProbeMarkerRaw = obj['selfProbeMarker'];
  const selfProbeMarker: SelfProbeMarker | undefined =
    typeof selfProbeMarkerRaw === 'string' && selfProbeMarkerRaw
      ? (selfProbeMarkerRaw as SelfProbeMarker)
      : undefined;
  return {
    user: { name, color },
    role,
    canPersist,
    ...(persistTarget ? { persistTarget } : {}),
    ...(browserId ? { browserId } : {}),
    ...(selfProbeMarker ? { selfProbeMarker } : {}),
  };
}

export function parseClientId(raw: number): ClientId {
  return raw as ClientId;
}

// Stays `unknown`: callers only compare it for change detection, never destructure it.
export function parsePeerCursorValue(raw: unknown): unknown {
  const obj = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};
  return obj['cursor'];
}

export function parseRoomId(raw: string | null): RoomId | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as RoomId) : null;
}

export function parseSelfProbeMarker(raw: string | null): SelfProbeMarker | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as SelfProbeMarker) : null;
}

export function parseRoomName(raw: string | null): RoomName | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as RoomName) : null;
}

export function parseRoomCredential(raw: string | null): RoomCredential | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? (trimmed as RoomCredential) : null;
}

export function parseLocalCacheEnabled(raw: string | null): LocalCacheEnabled {
  return (raw !== '0') as LocalCacheEnabled;
}

export function parseKeyFingerprint(raw: string | null): KeyFingerprint | null {
  return raw && /^[0-9a-f]{64}$/.test(raw) ? (raw as KeyFingerprint) : null;
}

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

const TURN_PREFS_FALLBACK: TurnPrefs = {
  urls: [],
  username: parseTurnUsername(''),
  credential: parseTurnCredential(''),
  fallback: FallbackTurnPolicy.OpenRelay,
};

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

export function parseDisplayName(raw: string | null): DisplayName {
  const trimmed = raw?.trim();
  return trimmed ? (trimmed as DisplayName) : FALLBACK_NAME;
}

// Degrades to pickDefault() rather than surfacing a color no longer in the current (shrunk/reordered) palette.
export function parseStoredColor(
  raw: string | null,
  palette: readonly CursorColor[],
  pickDefault: () => CursorColor,
): CursorColor {
  return raw && (palette as readonly string[]).includes(raw) ? (raw as CursorColor) : pickDefault();
}
