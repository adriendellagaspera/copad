import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Collab, CollabConnect, RoomId, SignalingUrl, Diagnostics, PeerConnId, IceServer } from './types.js';
import { Transport, IceCandidateType } from './types.js';
import type { RoomCipher } from './roomCipher.js';
import type { LocalCacheEnabled } from './cache.js';
import { createCollabCore } from './core.js';
import { defaultIceStatsReader, type IceStatsReader, type PeerConnectionLike } from './iceStats.js';
import { startSignalingKeepalive } from './signalingKeepalive.js';

// Local types for y-webrtc's private room internals — an IO boundary between
// this adapter and the library. Localising them here means a y-webrtc API
// change only touches this interface, not the whole adapter.
interface WebrtcRoomConn {
  readonly peer?: { readonly _pc?: PeerConnectionLike };
  // y-webrtc creates a WebrtcConn optimistically on 'announce' (discovery) and
  // only flips `connected` true when its data channel actually opens. Document
  // sync and awareness flow only over an open channel, so this is the honest
  // "can we exchange data with this peer?" flag.
  readonly connected?: boolean;
}
interface WebrtcRoom {
  readonly webrtcConns: Map<string, WebrtcRoomConn>;
  readonly bcConns: Map<string, unknown>;
}
// A y-webrtc SignalingConn (extends lib0's WebsocketClient): `connected` reflects
// the live socket state and it emits 'connect'/'disconnect' as the socket flaps.
// This is the honest "am I attached to a signaling server?" signal — unlike
// `provider.connected`, which is just `shouldConnect && room !== null` and so is
// true from construction even while every handshake is still failing.
type SignalingEvent = 'connect' | 'disconnect';
interface SignalingConnLike {
  readonly connected: boolean;
  on(event: SignalingEvent, cb: () => void): void;
  off(event: SignalingEvent, cb: () => void): void;
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

    // Fire the wake-up ping before constructing the provider: y-webrtc's
    // constructor opens its signaling WebSocket synchronously, so starting
    // the keepalive after that point lets a cold server fail the first
    // connection attempt before the ping ever reaches it.
    const stopKeepalive = startSignalingKeepalive(opts.signaling);

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
    // Count only WebRTC conns whose data channel is actually open: a conn is
    // created on discovery (`announce`) before its channel connects, and until it
    // does, nothing syncs. Counting those unconnected conns made the status pill
    // claim "connected/synced" while a peer was present but unreachable (e.g. NAT
    // traversal failing with no working TURN). BroadcastChannel conns are always
    // live once present, so they count as-is.
    const peerCount = (): number => {
      const r = room_();
      if (!r) return 0;
      let connected = 0;
      r.webrtcConns?.forEach((c) => { if (c.connected) connected += 1; });
      return connected + (r.bcConns?.size ?? 0);
    };

    // The provider's signaling sockets (shared module singletons keyed by URL),
    // read at the library IO boundary. `webrtc.signalingConns` is populated
    // synchronously by the constructor's connect(), so it's ready here.
    const signalingConns = (): SignalingConnLike[] =>
      (webrtc.signalingConns as unknown as SignalingConnLike[] | undefined) ?? [];

    // Attached = a signaling socket is genuinely up, OR a peer is already present
    // (two same-browser tabs sync over BroadcastChannel without any signaling).
    // This is what stops the pill from showing "waiting/no peers" while every
    // signaling handshake is still failing against a cold server — it now
    // correctly reads "connecting…" until a socket actually comes up.
    const isAttached = (): boolean =>
      signalingConns().some((c) => c.connected) || peerCount() > 0;

    const core = createCollabCore({
      doc,
      room,
      cache: opts.cache,
      isAttached,
      peerCount,
    });

    // y-webrtc emits `status`/`peers` on room + peer changes, but NOT when a
    // signaling socket connects while we're alone — so a cold server coming up
    // would leave the pill stuck on "connecting…". Bridge each signaling
    // socket's connect/disconnect into the status machine. Conns are shared
    // singletons that can be recreated on reconnect(), so track what we wired
    // and re-bind after a reconnect.
    const onSignalingFlap = (): void => core.emitStatus();
    let wiredConns: SignalingConnLike[] = [];
    const rewireSignaling = (): void => {
      for (const c of wiredConns) {
        c.off('connect', onSignalingFlap);
        c.off('disconnect', onSignalingFlap);
      }
      wiredConns = signalingConns();
      for (const c of wiredConns) {
        c.on('connect', onSignalingFlap);
        c.on('disconnect', onSignalingFlap);
      }
    };
    rewireSignaling();

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
        // WebRTC connections are rebuilt from scratch. connect() may recreate the
        // signaling conns, so re-bind our listeners and re-emit the fresh status.
        webrtc.disconnect();
        webrtc.connect();
        rewireSignaling();
        core.emitStatus();
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
          // Real signaling-socket state, not `webrtc.connected` (which is just
          // shouldConnect && room !== null and true from construction).
          signaling: signalingConns().some((c) => c.connected),
          peers: (r?.webrtcConns.size ?? 0) + (r?.bcConns.size ?? 0),
          connections,
        };
      },
      destroy() {
        stopKeepalive();
        // Unbind signaling listeners (conns are shared singletons that outlive us).
        for (const c of wiredConns) {
          c.off('connect', onSignalingFlap);
          c.off('disconnect', onSignalingFlap);
        }
        wiredConns = [];
        // core detaches the cache first, then we drop the provider and doc.
        core.destroy();
        webrtc.destroy();
        doc.destroy();
      },
    };
  };
}
