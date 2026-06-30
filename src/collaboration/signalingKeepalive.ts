/**
 * Keep-alive pings for a hosted signaling server.
 *
 * Render (free / starter) and similar platforms spin down a service after
 * ~15 minutes of inactivity. The y-webrtc signaling server responds to plain
 * HTTP GET requests with "okay", so pinging it periodically over HTTP/HTTPS
 * keeps the process alive and avoids a multi-second cold-start the next time a
 * peer opens the app — without requiring any server-side changes.
 *
 * Pinging is skipped when the tab is hidden (Page Visibility API), since there
 * are no active WebRTC connections to benefit from a warm server at that point.
 */

import type { SignalingUrl } from './types.js';

/** 4 minutes — comfortably below any platform's 15-min inactivity threshold. */
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;

/** Convert a ws/wss signaling URL to its http/https equivalent. */
function toHttpUrl(url: SignalingUrl): string | null {
  try {
    const u = new URL(url as string);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Start periodic HTTP pings to each signaling server so they stay warm on
 * platforms that spin down idle processes. Returns a `stop` function that
 * cancels the interval — call it from the collab adapter's `destroy()`.
 *
 * An immediate ping is sent on startup to wake the server fast if it's cold
 * (before y-webrtc's first WebSocket attempt has a chance to fail).
 */
export function startSignalingKeepalive(servers: SignalingUrl[]): () => void {
  const urls = servers.map(toHttpUrl).filter((u): u is string => u !== null);
  if (urls.length === 0) return () => {};

  const ping = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    for (const url of urls) {
      fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }
  };

  ping();
  const id = setInterval(ping, KEEPALIVE_INTERVAL_MS);
  return () => clearInterval(id);
}
