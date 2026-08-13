import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Collab, CollabConnect, RoomId, WebsocketUrl } from './types.js';
import { Transport } from './types.js';
import type { LocalCacheEnabled } from './cache.js';
import { createCollabCore } from './core.js';

/** The hub sits in the data path and sees plaintext, so no `password` here
 *  (docs/contract.md §2). */
export interface WebsocketCollabOptions {
  url: WebsocketUrl;
  cache?: LocalCacheEnabled;
}

export function websocketCollab(opts: WebsocketCollabOptions): CollabConnect {
  return (room: RoomId): Collab => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(opts.url, room as string, doc);

    // Awareness holds every present client including us.
    const peerCount = (): number => Math.max(0, provider.awareness.getStates().size - 1);

    // `wsconnected` means attached to the server, not peered — presence comes
    // from awareness, hence the extra 'change' subscription below.
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
      transport: Transport.Hub,
      onStatus: core.onStatus,
      onSynced: core.onSynced,
      // No `reachingCount` — the hub has no discovered-but-unconnected state.
      onPresence: core.onPresence,
      reconnect() {
        provider.disconnect();
        provider.connect();
        // A manual retry earns a fresh window instead of the last attempt's timeout.
        core.resetConnectTimeout();
        core.emitStatus();
      },
      async getDiagnostics() {
        return {
          transport: Transport.Hub,
          signaling: !!provider.wsconnected,
          peers: Math.max(0, provider.awareness.getStates().size - 1),
          connections: [],
        };
      },
      destroy() {
        // Unbind before core detaches the cache and the provider is torn down.
        provider.awareness.off('change', core.emitStatus);
        core.destroy();
        provider.destroy();
        doc.destroy();
      },
    };
  };
}
