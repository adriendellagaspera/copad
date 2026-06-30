/**
 * Keep-alive pings for a hosted signaling server.
 *
 * Render (free / starter) and similar platforms spin down a service after
 * ~15 minutes of inactivity. The y-webrtc signaling server answers a plain
 * HTTP GET with "okay", so pinging it periodically over HTTP/HTTPS keeps the
 * process alive and avoids a multi-second cold start the next time a peer opens
 * the app — without any server-side change.
 *
 * Pinging is skipped while the tab is hidden (Page Visibility API): a backgrounded
 * tab has no active WebRTC connections that a warm server would help.
 */

import type { SignalingUrl, SignalingPingUrl } from './types.js';
import { SIGNALING_KEEPALIVE_MS, SIGNALING_KEEPALIVE_TIMEOUT_MS } from './constants.js';

/**
 * Parse a signaling URL into its HTTP(S) ping URL (`ws→http`, `wss→https`), or
 * `null` when it isn't a valid URL. The single cast site for {@link SignalingPingUrl}.
 */
function pingUrlOf(url: SignalingUrl): SignalingPingUrl | null {
  try {
    const u = new URL(url as string);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return u.toString() as SignalingPingUrl;
  } catch {
    return null;
  }
}

/**
 * Start periodic HTTP pings to each signaling server so a spin-down-on-idle host
 * stays warm. Returns a `stop` function that cancels the timer — call it from the
 * collab adapter's `destroy()`.
 *
 * An immediate ping fires on startup to wake a cold server fast, before
 * y-webrtc's first WebSocket attempt has a chance to fail against it.
 */
export function startSignalingKeepalive(servers: SignalingUrl[]): () => void {
  const targets = servers
    .map(pingUrlOf)
    .filter((u): u is SignalingPingUrl => u !== null);
  if (targets.length === 0) return () => {};

  const ping = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    for (const url of targets) {
      fetch(url as string, {
        method: 'GET',
        signal: AbortSignal.timeout(SIGNALING_KEEPALIVE_TIMEOUT_MS),
      }).catch(() => {});
    }
  };

  ping();
  const id = setInterval(ping, SIGNALING_KEEPALIVE_MS);
  return () => clearInterval(id);
}
