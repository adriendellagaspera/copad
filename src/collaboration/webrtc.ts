import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Collab, CollabConnect, ConnStatus, RoomId, SignalingUrl, Diagnostics } from './types.js';
import type { RoomCipher } from './roomCipher.js';
import { attachLocalCache, type LocalCache, type LocalCacheEnabled } from './cache.js';

// Best-effort: inspect a peer connection's selected ICE candidate pair to tell
// whether the media path is direct (host/srflx) or routed through a TURN relay.
// Reaches into RTCPeerConnection.getStats(); guarded since shapes vary by browser.
async function peerConnectionType(
  pc: RTCPeerConnection,
): Promise<'direct' | 'relay' | 'unknown'> {
  try {
    const stats = await pc.getStats();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = [];
    stats.forEach((r) => rows.push(r));
    let pairId: string | undefined;
    for (const r of rows) {
      if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
    }
    let pair =
      rows.find((r) => r.type === 'candidate-pair' && r.id === pairId) ??
      rows.find((r) => r.type === 'candidate-pair' && (r.nominated || r.selected)) ??
      rows.find((r) => r.type === 'candidate-pair' && r.state === 'succeeded');
    if (!pair) return 'unknown';
    const local = rows.find((r) => r.type === 'local-candidate' && r.id === pair.localCandidateId);
    const t = local?.candidateType as string | undefined;
    if (t === 'relay') return 'relay';
    if (t) return 'direct';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

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

    // Local cache: keeps the doc across reloads even with no storage backend.
    const cache: LocalCache | undefined = opts.cache
      ? attachLocalCache(room as string, doc)
      : undefined;

    const statusFns = new Set<(s: ConnStatus) => void>();
    const syncedFns = new Set<(b: boolean) => void>();
    let synced = false;

    // `webrtc.connected` means "attached to a signaling server" — it does NOT
    // imply a physical peer. So we report `connecting` until signaling attaches,
    // then `waiting` while alone in the room, and only `connected` once a peer
    // is actually present. That distinction tells a user whether signaling is
    // broken (stuck on `connecting`) or simply nobody else has joined yet.
    const hasPeers = (): boolean => {
      const room = webrtc.room;
      if (!room) return false;
      return (room.webrtcConns?.size ?? 0) + (room.bcConns?.size ?? 0) > 0;
    };

    const computeStatus = (): ConnStatus => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
      if (!webrtc.connected) return 'connecting';
      return hasPeers() ? 'connected' : 'waiting';
    };

    const emitStatus = (): void => {
      const s = computeStatus();
      statusFns.forEach((fn) => fn(s));
    };
    const emitSynced = (): void => syncedFns.forEach((fn) => fn(synced));

    webrtc.on('status', emitStatus);
    webrtc.on('peers', emitStatus);
    webrtc.on('synced', (e: { synced: boolean }) => {
      synced = e.synced;
      emitSynced();
    });

    const onNetwork = (): void => emitStatus();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onNetwork);
      window.addEventListener('offline', onNetwork);
    }

    return {
      doc,
      awareness: webrtc.awareness,
      transport: 'p2p',
      onStatus(fn) {
        statusFns.add(fn);
        fn(computeStatus());
        return () => statusFns.delete(fn);
      },
      onSynced(fn) {
        syncedFns.add(fn);
        fn(synced);
        return () => syncedFns.delete(fn);
      },
      reconnect() {
        // Drop and re-attach to the signaling server; peers re-announce and the
        // WebRTC connections are rebuilt from scratch.
        webrtc.disconnect();
        webrtc.connect();
      },
      async getDiagnostics(): Promise<Diagnostics> {
        const r = webrtc.room;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const webrtcConns: Map<string, any> | undefined = r?.webrtcConns;
        const entries = webrtcConns ? [...webrtcConns.entries()] : [];
        const connections = await Promise.all(
          entries.map(async ([id, c]) => {
            const pc = c?.peer?._pc as RTCPeerConnection | undefined;
            return { id, type: pc ? await peerConnectionType(pc) : ('unknown' as const) };
          }),
        );
        return {
          transport: 'p2p',
          signaling: !!webrtc.connected,
          peers: (r?.webrtcConns?.size ?? 0) + (r?.bcConns?.size ?? 0),
          connections,
        };
      },
      destroy() {
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', onNetwork);
          window.removeEventListener('offline', onNetwork);
        }
        statusFns.clear();
        syncedFns.clear();
        // Detach the IndexedDB connection first so a subsequent clear isn't blocked.
        cache?.destroy();
        webrtc.destroy();
        doc.destroy();
      },
    };
  };
}
