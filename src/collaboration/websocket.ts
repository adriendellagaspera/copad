import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Collab, CollabConnect, RoomId, WebsocketUrl } from './types.js';
import type { LocalCacheEnabled } from './cache.js';
import { createCollabCore } from './core.js';

/**
 * Client ↔ server (hub) collaboration transport.
 *
 * Unlike {@link webrtcCollab}, this is **not** peer-to-peer: every client holds
 * one WebSocket to a central server that stores the doc, merges updates, and
 * rebroadcasts them. Because clients only make *outbound* connections to one
 * public server, there is no WebRTC and no NAT traversal — so it works through
 * carrier NAT / CGNAT / symmetric NAT where STUN/TURN would be required.
 *
 * Trade-off: the server is in the data path and sees plaintext Yjs updates, so
 * the WebRTC `password` (end-to-end encryption) does not apply here.
 */
export interface WebsocketCollabOptions {
  /** Validated hub URL that relays edits between clients. */
  url: WebsocketUrl;
  /** Mirror the doc into IndexedDB so it survives a reload without a backend. */
  cache?: LocalCacheEnabled;
}

export function websocketCollab(opts: WebsocketCollabOptions): CollabConnect {
  return (room: RoomId): Collab => {
    const doc = new Y.Doc();
    // RoomId extends string — cast back to string at the y-websocket IO boundary.
    const provider = new WebsocketProvider(opts.url, room as string, doc);

    // Awareness holds every present client including us, so "peers" is size − 1.
    const peerCount = (): number => Math.max(0, provider.awareness.getStates().size - 1);

    // `provider.wsconnected` means "attached to the server", not "peered". Peer
    // presence comes from awareness, not the socket — so we also recompute on its
    // 'change'. This mirrors the webrtc adapter so the status pill reads identically.
    const core = createCollabCore({
      doc,
      room,
      cache: opts.cache,
      isAttached: () => provider.wsconnected,
      peerCount,
    });

    provider.on('status', core.emitStatus);
    provider.on('sync', (isSynced: boolean) => core.setSynced(isSynced));
    provider.awareness.on('change', core.emitStatus);

    return {
      doc,
      awareness: provider.awareness,
      transport: 'hub',
      onStatus: core.onStatus,
      onSynced: core.onSynced,
      destroy() {
        // Drop the awareness listener, then core detaches the cache before we
        // tear down the provider and doc.
        provider.awareness.off('change', core.emitStatus);
        core.destroy();
        provider.destroy();
        doc.destroy();
      },
    };
  };
}
