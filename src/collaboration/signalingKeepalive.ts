// The y-webrtc signaling server answers a plain HTTP GET, so hosts that spin
// down on idle stay warm. Deliberately keeps pinging while the tab is hidden:
// a backgrounded tab's WebRTC channels stay live, so its server still matters.

import type { SignalingUrl, SignalingPingUrl } from './types.js';
import { SIGNALING_KEEPALIVE_MS, SIGNALING_KEEPALIVE_TIMEOUT_MS } from './constants.js';

function pingUrlOf(url: SignalingUrl): SignalingPingUrl | null {
  try {
    const u = new URL(url as string);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return u.toString() as SignalingPingUrl;
  } catch {
    return null;
  }
}

/** Pings immediately so a cold server wakes before y-webrtc's first attempt. */
export function startSignalingKeepalive(servers: SignalingUrl[]): () => void {
  const targets = servers
    .map(pingUrlOf)
    .filter((u): u is SignalingPingUrl => u !== null);
  if (targets.length === 0) return () => {};

  const ping = (): void => {
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
