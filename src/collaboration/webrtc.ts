import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Collab, CollabConnect, RoomId, SignalingUrl, Diagnostics, PeerConnId, IceServer } from './types.js';
import { Transport, IceCandidateType } from './types.js';
import type { RoomCipher } from './roomCipher.js';
import type { LocalCacheEnabled } from './cache.js';
import { createCollabCore } from './core.js';
import { defaultIceStatsReader, type IceStatsReader, type PeerConnectionLike } from './iceStats.js';
import { startSignalingKeepalive } from './signalingKeepalive.js';

// y-webrtc internals typing rationale: docs/architecture.md "webrtcCollab()'s y-webrtc internals typing".
interface WebrtcRoomConn {
  readonly peer?: { readonly _pc?: PeerConnectionLike };
  readonly connected?: boolean;
}
interface WebrtcRoom {
  readonly webrtcConns: Map<string, WebrtcRoomConn>;
  readonly bcConns: Map<string, unknown>;
}
type SignalingEvent = 'connect' | 'disconnect';
interface SignalingConnLike {
  readonly connected: boolean;
  on(event: SignalingEvent, cb: () => void): void;
  off(event: SignalingEvent, cb: () => void): void;
}

export interface WebrtcCollabOptions {
  signaling: SignalingUrl[];
  cipher?: RoomCipher;
  /** Passing TURN here is what makes desktop↔mobile work across restrictive carrier NATs. */
  iceServers?: IceServer[];
  cache?: LocalCacheEnabled;
  iceStatsReader?: IceStatsReader;
}

export function webrtcCollab(opts: WebrtcCollabOptions): CollabConnect {
  return (room: RoomId): Collab => {
    const doc = new Y.Doc();
    const readIceStats = opts.iceStatsReader ?? defaultIceStatsReader;
    const password = opts.cipher?.password(room) ?? undefined;

    // y-webrtc's constructor opens signaling synchronously; start the keepalive first so a cold server sees it before the first connect attempt.
    const stopKeepalive = startSignalingKeepalive(opts.signaling);

    const webrtc = new WebrtcProvider(room as string, doc, {
      signaling: opts.signaling,
      password,
      // simple-peer only knows public STUN by default; feed our resolved ICE list so a configured TURN relay is used.
      ...(opts.iceServers && opts.iceServers.length
        ? { peerOpts: { config: { iceServers: opts.iceServers } } }
        : {}),
    });

    const room_ = (): WebrtcRoom | undefined => webrtc.room as unknown as WebrtcRoom | undefined;

    const peerCount = (): number => {
      const r = room_();
      if (!r) return 0;
      let connected = 0;
      r.webrtcConns?.forEach((c) => { if (c.connected) connected += 1; });
      return connected + (r.bcConns?.size ?? 0);
    };

    const reachingCount = (): number => {
      const r = room_();
      if (!r) return 0;
      let reaching = 0;
      r.webrtcConns?.forEach((c) => { if (!c.connected) reaching += 1; });
      return reaching;
    };

    const signalingConns = (): SignalingConnLike[] =>
      (webrtc.signalingConns as unknown as SignalingConnLike[] | undefined) ?? [];

    // A same-browser peer pair syncs over BroadcastChannel with no signaling socket at all.
    const isAttached = (): boolean =>
      signalingConns().some((c) => c.connected) || peerCount() > 0;

    const core = createCollabCore({
      doc,
      room,
      cache: opts.cache,
      // Same secret encrypts the transport and the local cache at rest, so a cached doc can't be read back without the room key.
      cacheKey: password,
      isAttached,
      peerCount,
      reachingCount,
    });

    // y-webrtc emits no status/peers event for a signaling socket coming up while alone; bridge it in directly. Conns are shared singletons re-created by connect(), so re-bind after every reconnect().
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
      onPresence: core.onPresence,
      reconnect() {
        webrtc.disconnect();
        webrtc.connect();
        rewireSignaling();
        core.resetConnectTimeout();
        core.emitStatus();
      },
      async getDiagnostics(): Promise<Diagnostics> {
        const r = room_();
        const entries = r ? [...r.webrtcConns.entries()] : [];
        const connections = await Promise.all(
          entries.map(async ([id, c]) => {
            const pc = c.peer?._pc;
            return { id: id as PeerConnId, type: pc ? await readIceStats(pc) : IceCandidateType.Unknown };
          }),
        );
        return {
          transport: Transport.P2P,
          signaling: signalingConns().some((c) => c.connected),
          peers: (r?.webrtcConns.size ?? 0) + (r?.bcConns.size ?? 0),
          connections,
        };
      },
      destroy() {
        stopKeepalive();
        for (const c of wiredConns) {
          c.off('connect', onSignalingFlap);
          c.off('disconnect', onSignalingFlap);
        }
        wiredConns = [];
        core.destroy();
        webrtc.destroy();
        doc.destroy();
      },
    };
  };
}
