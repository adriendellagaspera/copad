// Resolve the signaling server list, flagging the two ways it silently breaks
// real-time collaboration on a deployed site:
//
// 1. No VITE_SIGNALING_URL set — falling back to ws://localhost only works in
//    local dev. On any other origin there is no shared rendezvous, so peers on
//    other devices never discover each other.
// 2. An insecure ws:// server on an https:// page — browsers block this as
//    mixed content, so the signaling socket never opens.

/** Hostnames that mean "this is local dev", where ws://localhost is reasonable. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '']);

const DEFAULT_DEV_SIGNALING = 'ws://localhost:4444';

const list = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export interface SignalingResolution {
  /** Signaling servers to hand to y-webrtc (may be empty if misconfigured). */
  readonly servers: string[];
  /** Human-readable problem to surface, or undefined when the config is sound. */
  readonly warning?: string;
}

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

export function resolveSignaling(
  raw: string | undefined,
  loc: { protocol: string; hostname: string },
): SignalingResolution {
  const isLocalHost = LOCAL_HOSTS.has(loc.hostname);
  const isSecurePage = loc.protocol === 'https:';
  const servers = list(raw);

  if (servers.length === 0) {
    if (isLocalHost) return { servers: [DEFAULT_DEV_SIGNALING] };
    return {
      servers: [],
      warning:
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

/**
 * Build the ICE server list for WebRTC. A public STUN server is enough for most
 * home/office NATs; a TURN relay is needed for restrictive networks — notably
 * mobile carriers (CGNAT / symmetric NAT), where STUN alone fails and
 * desktop↔phone sessions never connect.
 */
export function resolveIceServers(env: {
  VITE_STUN_URL?: string;
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}): RTCIceServer[] {
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
