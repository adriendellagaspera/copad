import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Collab, CollabConnect, RoomId, SignalingUrl, Diagnostics, PeerConnId, IceServer } from './types.js';
import { Transport, IceCandidateType } from './types.js';
import type { RoomCipher } from './roomCipher.js';
import type { LocalCacheEnabled } from './cache.js';
import { createCollabCore } from './core.js';
import { defaultIceStatsReader, type IceStatsReader, type PeerConnectionLike } from './iceStats.js';

// Local types for y-webrtc's private room internals — an IO boundary between
// this adapter and the library. Localising them here means a y-webrtc API
// change only touches this interface, not the whole adapter.
interface WebrtcRoomConn {
  readonly peer?: { readonly _pc?: PeerConnectionLike };
}
interface WebrtcRoom {
  readonly webrtcConns: Map<string, WebrtcRoomConn>;
  readonly bcConns: Map<string, unknown>;
}

export interface WebrtcCollabOptions {
  /** Validated signaling servers peers use to discover each other. */
  signaling: SignalingUrl[];
  /** Room cipher — supplies the y-webrtc AES password per room, or null for
   *  plaintext. Applies to this transport only; the WebSocket hub ignores it. */
  cipher?: RoomCipher;
  /** ICE servers (STUN/TURN) for WebRTC NAT traversal. Passing TURN here is
   *  what makes desktop↔mobile work across restrictive carrier NATs. */
  iceServers?: IceServer[];
  /** Mirror the doc into IndexedDB so it survives a reload without a backend. */
  cache?: LocalCacheEnabled;
  /** Override how the selected ICE candidate type is read from an RTCPeerConnection.
   *  Defaults to `defaultIceStatsReader`; inject a custom reader in tests or for
   *  browser-specific stat shapes. */
  iceStatsReader?: IceStatsReader;
}

export function webrtcCollab(opts: WebrtcCollabOptions): CollabConnect {
  return (room: RoomId): Collab => {
    const doc = new Y.Doc();
    const readIceStats = opts.iceStatsReader ?? defaultIceStatsReader;
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

    // Cast at the single IO boundary with the library; narrowed by WebrtcRoom.
    // Go through `unknown` because y-webrtc's Room type differs structurally
    // (e.g. bcConns is a Set, not a Map) — the cast documents the intentional
    // mismatch between library internals and our local ACL interface.
    const room_ = (): WebrtcRoom | undefined => webrtc.room as unknown as WebrtcRoom | undefined;

    // Peer carriage is read from the y-webrtc room (WebRTC + same-browser BroadcastChannel).
    const peerCount = (): number => {
      const r = room_();
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
      transport: Transport.P2P,
      onStatus: core.onStatus,
      onSynced: core.onSynced,
      reconnect() {
        // Drop and re-attach to the signaling server; peers re-announce and the
        // WebRTC connections are rebuilt from scratch.
        webrtc.disconnect();
        webrtc.connect();
      },
      async getDiagnostics(): Promise<Diagnostics> {
        const r = room_();
        const entries = r ? [...r.webrtcConns.entries()] : [];
        const connections = await Promise.all(
          entries.map(async ([id, c]) => {
            const pc = c.peer?._pc;
            // Cast the y-webrtc map key to the branded id at this IO boundary.
            return { id: id as PeerConnId, type: pc ? await readIceStats(pc) : IceCandidateType.Unknown };
          }),
        );
        return {
          transport: Transport.P2P,
          signaling: !!webrtc.connected,
          peers: (r?.webrtcConns.size ?? 0) + (r?.bcConns.size ?? 0),
          connections,
        };
      },
      destroy() {
        // core detaches the cache first, then we drop the provider and doc.
        core.destroy();
        webrtc.destroy();
        doc.destroy();
      },
    };
  };
}
