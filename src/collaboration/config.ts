// Resolve the signaling server list, flagging the two ways it silently breaks
// real-time collaboration on a deployed site:
//
// 1. No VITE_SIGNALING_URL set — falling back to ws://localhost only works in
//    local dev. On any other origin there is no shared rendezvous, so peers on
//    other devices never discover each other.
// 2. An insecure ws:// server on an https:// page — browsers block this as
//    mixed content, so the signaling socket never opens.

import type { SignalingUrl, WebsocketUrl, RoomId } from './types.js';
import type { RoomAccess } from './roomAccess.js';
import type { RoomCipher } from './roomCipher.js';
import { publicAccess, sitePassword, roomPassword } from './roomAccess.js';
import { plaintext } from './roomCipher.js';
import { secretLink, type SecretLinkPort } from './secretLink.js';

/** Hostnames that mean "this is local dev", where ws://localhost is reasonable. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '']);

// Trusted literal — the single sanctioned brand entry for the dev default.
const DEFAULT_DEV_SIGNALING = 'ws://localhost:4444' as SignalingUrl;

const list = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** ws:// or wss:// — the only schemes y-webrtc / y-websocket understand. */
const WS_URL = /^wss?:\/\/\S+$/i;

/** Parse a single signaling URL, branding it only if it is a real ws/wss URL. */
function parseSignalingUrl(raw: string): SignalingUrl | null {
  return WS_URL.test(raw) ? (raw as SignalingUrl) : null;
}

/** Parse the hub URL, branding it only if it is a real ws/wss URL. */
function parseWebsocketUrl(raw: string): WebsocketUrl | null {
  return WS_URL.test(raw) ? (raw as WebsocketUrl) : null;
}

export interface SignalingResolution {
  /** Signaling servers to hand to y-webrtc (may be empty if misconfigured). */
  readonly servers: SignalingUrl[];
  /** User-facing problem description, or undefined when the config is sound. */
  readonly warning?: string;
  /** Developer-facing details for the browser console. */
  readonly technicalWarning?: string;
}

/** HTTP/HTTPS scheme of the current page, e.g. `'https:'`. */
export type PageProtocol = string & { readonly _brand: 'PageProtocol' };

/** Hostname of the current page, e.g. `'app.example.com'`. */
export type PageHostname = string & { readonly _brand: 'PageHostname' };

/** The page origin details needed to detect mixed-content and local-dev conditions. */
export interface PageLocation {
  readonly protocol: PageProtocol;
  readonly hostname: PageHostname;
}

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

export function resolveSignaling(
  raw: string | undefined,
  loc: PageLocation,
): SignalingResolution {
  const isLocalHost = LOCAL_HOSTS.has(loc.hostname);
  const isSecurePage = loc.protocol === 'https:';
  // list() is shared across signaling/STUN/TURN; parse each entry here, dropping
  // anything that isn't a real ws/wss URL.
  const servers = list(raw)
    .map(parseSignalingUrl)
    .filter((s): s is SignalingUrl => s !== null);

  if (servers.length === 0) {
    if (isLocalHost) return { servers: [DEFAULT_DEV_SIGNALING] };
    return {
      servers: [],
      warning: "This site isn't set up for real-time sync across devices — nothing you need to do.",
      technicalWarning:
        'No signaling server is configured (VITE_SIGNALING_URL), so real-time ' +
        'collaboration with other devices is disabled. Deploy a y-webrtc ' +
        'signaling server over wss:// and set VITE_SIGNALING_URL — see the ' +
        'README "Deployment" section.',
    };
  }

  if (isSecurePage) {
    const insecure = servers.filter((s) => s.startsWith('ws://'));
    if (insecure.length === servers.length) {
      return {
        servers,
        warning:
          'The signaling server uses insecure ws:// but the app is served over ' +
          'https:// — browsers block this as mixed content, so peers can’t ' +
          'connect. Use a wss:// signaling URL.',
      };
    }
    if (insecure.length > 0) {
      return {
        servers,
        warning:
          `Some signaling servers use insecure ws:// (${insecure.join(', ')}) and ` +
          'will be blocked on this https:// page (mixed content).',
      };
    }
  }

  return { servers };
}

export interface WebsocketResolution {
  /** Collaboration server URL, absent when the websocket transport is not configured. */
  readonly url?: WebsocketUrl;
  /** Human-readable problem to surface, or undefined when the config is sound. */
  readonly warning?: string;
}

/** The collaboration transport, selected by `VITE_COLLAB_TRANSPORT`. */
export type CollabTransport = 'webrtc' | 'websocket';

/**
 * Choose the collaboration transport. Explicit by design (`VITE_COLLAB_TRANSPORT`)
 * rather than inferred from another var's presence: only `websocket` selects the
 * hub; anything else — unset, `webrtc`, or a typo — stays on the default WebRTC.
 * Accepts a raw string (env input is untrusted) and narrows it to CollabTransport.
 */
export function resolveTransport(raw: string | undefined): CollabTransport {
  return (raw ?? '').trim().toLowerCase() === 'websocket' ? 'websocket' : 'webrtc';
}

/**
 * Parse the y-websocket (hub) URL, used when the transport is `websocket`.
 * `url` is absent when none is configured or the value isn't a ws/wss URL.
 * An insecure ws:// URL parses fine but is flagged below: the browser blocks it
 * as mixed content on an https:// page, yet it's still the configured URL.
 */
export function resolveWebsocket(
  raw: string | undefined,
  loc: Pick<PageLocation, 'protocol'>,
): WebsocketResolution {
  const url = parseWebsocketUrl((raw ?? '').trim());
  if (!url) return {};

  if (loc.protocol === 'https:' && url.startsWith('ws://')) {
    return {
      url,
      warning:
        'The collaboration server uses insecure ws:// but the app is served ' +
        'over https:// — browsers block this as mixed content, so it can’t ' +
        'connect. Use a wss:// URL.',
    };
  }

  return { url };
}

/**
 * A room's access gate paired with the cipher that encrypts it. Resolved as one
 * value so each strategy keeps its concrete type end-to-end — in particular the
 * `secret-link` object, which *is* both ports, is never widened to `RoomAccess`
 * and cast back to `RoomCipher`.
 */
export interface RoomStrategy {
  readonly access: RoomAccess;
  readonly cipher: RoomCipher;
}

/** A cipher whose key material is exactly the access gate's credential, so the
 *  room is encrypted with the same secret used to admit peers. */
function sharedKeyCipher(access: RoomAccess): RoomCipher {
  return { password: (room: RoomId) => access.credential(room) };
}

/**
 * Parse `VITE_ROOM_AUTH` into a typed {@link RoomStrategy} — the single place
 * where the raw env string crosses the domain boundary. Access and cipher are
 * built together so no strategy loses type information: `secret-link` yields one
 * {@link SecretLinkPort} object used directly as both ports (no cast). Unknown
 * values fall back to public + plaintext so a typo never silently breaks
 * collaboration.
 */
export function resolveRoomStrategy(raw: string | undefined): RoomStrategy {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'site-password': {
      const access = sitePassword(import.meta.env.VITE_ROOM_PASSWORD ?? '');
      return { access, cipher: sharedKeyCipher(access) };
    }
    case 'room-password': {
      const access = roomPassword();
      return { access, cipher: sharedKeyCipher(access) };
    }
    case 'secret-link': {
      const link: SecretLinkPort = secretLink();
      return { access: link, cipher: link };
    }
    default:
      return { access: publicAccess(), cipher: plaintext() };
  }
}

/** ICE server environment variables read at startup for WebRTC NAT traversal. */
export interface IceEnv {
  VITE_STUN_URL?: string;
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

/**
 * Build the ICE server list for WebRTC. A public STUN server is enough for most
 * home/office NATs; a TURN relay is needed for restrictive networks — notably
 * mobile carriers (CGNAT / symmetric NAT), where STUN alone fails and
 * desktop↔phone sessions never connect.
 */
export function resolveIceServers(env: IceEnv): RTCIceServer[] {
  const servers: RTCIceServer[] = [];

  // VITE_STUN_URL="" (explicitly empty) disables the STUN default on purpose.
  const stun = list(env.VITE_STUN_URL ?? DEFAULT_STUN);
  if (stun.length) servers.push({ urls: stun });

  const turnUrls = list(env.VITE_TURN_URL);
  if (turnUrls.length) {
    const turn: RTCIceServer = { urls: turnUrls };
    if (env.VITE_TURN_USERNAME) turn.username = env.VITE_TURN_USERNAME;
    if (env.VITE_TURN_CREDENTIAL) turn.credential = env.VITE_TURN_CREDENTIAL;
    servers.push(turn);
  }

  return servers;
}
