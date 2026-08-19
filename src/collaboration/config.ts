import type { SignalingUrl, WebsocketUrl, StunUrl, TurnUrl, RoomId, IceServer, IceServersUrl } from './types.js';
import { FallbackTurnPolicy } from './types.js';
import type { RoomAccess } from './roomAccess.js';
import type { RoomCipher } from './roomCipher.js';
import { publicAccess, sitePassword, roomPassword, RoomAccessMode } from './roomAccess.js';
import { plaintext } from './roomCipher.js';
import { secretLink, type SecretLinkPort } from './secretLink.js';
import { parseRoomId, parseSignalingUrl, parseWebsocketUrl, parseStunUrl, parseTurnUrl, parseTurnUsername, parseTurnCredential, parseIceServersUrl } from './parse.js';
import { LOCAL_HOSTS, DEFAULT_DEV_SIGNALING, DEFAULT_STUN } from './constants.js';

const list = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export interface SignalingResolution {
  readonly servers: SignalingUrl[];
  readonly warning?: string;
  readonly technicalWarning?: string;
}

export type PageProtocol = string & { readonly _brand: 'PageProtocol' };
export type PageHostname = string & { readonly _brand: 'PageHostname' };

export interface PageLocation {
  readonly protocol: PageProtocol;
  readonly hostname: PageHostname;
}

export function resolveSignaling(
  raw: string | undefined,
  loc: PageLocation,
): SignalingResolution {
  const isLocalHost = LOCAL_HOSTS.has(loc.hostname);
  const isSecurePage = loc.protocol === 'https:';
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
  readonly url?: WebsocketUrl;
  readonly warning?: string;
}

export type CollabTransport = 'webrtc' | 'websocket';

// Anything but an exact 'websocket' match (unset, 'webrtc', a typo) stays on default WebRTC — a bad env
// value never breaks collaboration.
export function resolveTransport(raw: string | undefined): CollabTransport {
  return (raw ?? '').trim().toLowerCase() === 'websocket' ? 'websocket' : 'webrtc';
}

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

// Free OpenRelay (metered.ca): best-effort, rate-limited, fine for a demo — bring your own for real use.
// Disable via `{ fallback: 'none' }` in resolveIceServers.
export const DEFAULT_TURN: IceServer = {
  urls: [
    parseTurnUrl('turn:openrelay.metered.ca:80')!,
    parseTurnUrl('turn:openrelay.metered.ca:443')!,
    parseTurnUrl('turns:openrelay.metered.ca:443')!,
  ],
  username: parseTurnUsername('openrelayproject'),
  credential: parseTurnCredential('openrelayproject'),
};

export interface RoomStrategy {
  readonly access: RoomAccess;
  readonly cipher: RoomCipher;
}

function sharedKeyCipher(access: RoomAccess): RoomCipher {
  return { password: (room: RoomId) => access.credential(room) };
}

// Unknown values fall back to public + plaintext so a typo never silently breaks collaboration.
export function resolveRoomStrategy(raw: string | undefined): RoomStrategy {
  switch ((raw ?? '').trim().toLowerCase()) {
    case RoomAccessMode.SitePassword: {
      const access = sitePassword(import.meta.env.VITE_ROOM_PASSWORD ?? '');
      return { access, cipher: sharedKeyCipher(access) };
    }
    case RoomAccessMode.RoomPassword: {
      const access = roomPassword();
      return { access, cipher: sharedKeyCipher(access) };
    }
    case RoomAccessMode.SecretLink: {
      const link: SecretLinkPort = secretLink();
      return { access: link, cipher: link };
    }
    default:
      return { access: publicAccess(), cipher: plaintext() };
  }
}

export type RoomMinted = boolean & { readonly _brand: 'RoomMinted' };

export interface LandingRoom {
  readonly room: RoomId;
  readonly minted: RoomMinted;
}

// Minting rather than adopting a default keeps a visitor's first act out of a stranger's document (contract §5).
export function resolveLandingRoom(
  roomParam: string | null,
  envDefaultRoom: string | undefined,
  mint: () => RoomId,
): LandingRoom {
  const asked = false as RoomMinted;
  const linked = parseRoomId(roomParam);
  if (linked) return { room: linked, minted: asked };
  const configured = parseRoomId(envDefaultRoom ?? '');
  if (configured) return { room: configured, minted: asked };
  return { room: mint(), minted: true as RoomMinted };
}

// When set, App.svelte fetches ICE servers from it (short-lived TURN creds minted server-side) instead of
// static VITE_TURN_* config.
export function resolveIceServersUrl(raw: string | undefined): IceServersUrl | undefined {
  return parseIceServersUrl((raw ?? '').trim()) ?? undefined;
}

export interface IceEnv {
  VITE_STUN_URL?: string;
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_PASSWORD?: string;
}

export function resolveIceServers(
  env: IceEnv,
  opts: { fallback?: FallbackTurnPolicy } = {},
): IceServer[] {
  const servers: IceServer[] = [];

  // VITE_STUN_URL="" (explicitly empty) disables the STUN default on purpose.
  const stun = list(env.VITE_STUN_URL ?? DEFAULT_STUN)
    .map(parseStunUrl)
    .filter((s): s is StunUrl => s !== null);
  if (stun.length) servers.push({ urls: stun });

  const turnUrls = list(env.VITE_TURN_URL)
    .map(parseTurnUrl)
    .filter((t): t is TurnUrl => t !== null);
  if (turnUrls.length) {
    servers.push({
      urls: turnUrls,
      ...(env.VITE_TURN_USERNAME ? { username: parseTurnUsername(env.VITE_TURN_USERNAME) } : {}),
      ...(env.VITE_TURN_PASSWORD ? { credential: parseTurnCredential(env.VITE_TURN_PASSWORD) } : {}),
    });
  } else if ((opts.fallback ?? FallbackTurnPolicy.OpenRelay) !== FallbackTurnPolicy.None) {
    servers.push(DEFAULT_TURN);
  }

  return servers;
}
