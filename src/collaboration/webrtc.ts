import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Collab, CollabConnect, RoomId, SignalingUrl } from './types.js';
import type { RoomCipher } from './roomCipher.js';
import type { LocalCacheEnabled } from './cache.js';
import { createCollabCore } from './core.js';

export interface WebrtcCollabOptions {
  /** Validated signaling servers peers use to discover each other. */
  signaling: SignalingUrl[];
  /** Room cipher — supplies the y-webrtc AES password per room, or null for
   *  plaintext. Applies to this transport only; the WebSocket hub ignores it. */
  cipher?: RoomCipher;
  /** ICE servers (STUN/TURN) for WebRTC NAT traversal. Passing TURN here is
   *  what makes desktop↔mobile work across restrictive carrier NATs. */
  iceServers?: RTCIceServer[];
  /** Mirror the doc into IndexedDB so it survives a reload without a backend. */
  cache?: LocalCacheEnabled;
}

export function webrtcCollab(opts: WebrtcCollabOptions): CollabConnect {
  return (room: RoomId): Collab => {
    const doc = new Y.Doc();
    // RoomId extends string — cast back to string at the y-webrtc IO boundary.
    // cipher.password() returns null for no encryption; y-webrtc expects undefined.
    const password = opts.cipher?.password(room) ?? undefined;
    const webrtc = new WebrtcProvider(room as string, doc, {
      signaling: opts.signaling,
      password,
      // simple-peer only knows about public STUN by default; feed it our resolved
      // ICE list so a configured TURN relay is actually used.
      ...(opts.iceServers && opts.iceServers.length
        ? { peerOpts: { config: { iceServers: opts.iceServers } } }
        : {}),
    });

    // Peer carriage is read from the y-webrtc room (WebRTC + same-browser BroadcastChannel).
    const peerCount = (): number => {
      const r = webrtc.room;
      if (!r) return 0;
      return (r.webrtcConns?.size ?? 0) + (r.bcConns?.size ?? 0);
    };

    // `webrtc.connected` means "attached to a signaling server", not "peered".
    const core = createCollabCore({
      doc,
      room,
      cache: opts.cache,
      isAttached: () => webrtc.connected,
      peerCount,
    });

    webrtc.on('status', core.emitStatus);
    webrtc.on('peers', core.emitStatus);
    webrtc.on('synced', (e: { synced: boolean }) => core.setSynced(e.synced));

    return {
      doc,
      awareness: webrtc.awareness,
      transport: 'p2p',
      onStatus: core.onStatus,
      onSynced: core.onSynced,
      destroy() {
        // core detaches the cache first, then we drop the provider and doc.
        core.destroy();
        webrtc.destroy();
        doc.destroy();
      },
    };
  };
}
