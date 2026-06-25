import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Collab, CollabConnect, ConnStatus, RoomId } from './types.js';

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
export function websocketCollab(opts: { url: string }): CollabConnect {
  return (room: RoomId): Collab => {
    const doc = new Y.Doc();
    // RoomId extends string — cast back to string at the y-websocket IO boundary.
    const provider = new WebsocketProvider(opts.url, room as string, doc);

    const statusFns = new Set<(s: ConnStatus) => void>();
    const syncedFns = new Set<(b: boolean) => void>();
    let synced = false;

    // `provider.wsconnected` means "attached to the server" — it does NOT imply
    // another human is here. So we report `connecting` until the socket opens,
    // then `waiting` while we're alone in the room (awareness holds only us),
    // and only `connected` once another peer's awareness state appears. This
    // mirrors the webrtc adapter so the status pill reads identically.
    const hasPeers = (): boolean => provider.awareness.getStates().size > 1;

    const computeStatus = (): ConnStatus => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
      if (!provider.wsconnected) return 'connecting';
      return hasPeers() ? 'connected' : 'waiting';
    };

    const emitStatus = (): void => {
      const s = computeStatus();
      statusFns.forEach((fn) => fn(s));
    };
    const emitSynced = (): void => syncedFns.forEach((fn) => fn(synced));

    provider.on('status', emitStatus);
    provider.on('sync', (isSynced: boolean) => {
      synced = isSynced;
      emitSynced();
    });
    // Peer presence is read from awareness, not the socket — recompute on change.
    provider.awareness.on('change', emitStatus);

    const onNetwork = (): void => emitStatus();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onNetwork);
      window.addEventListener('offline', onNetwork);
    }

    return {
      doc,
      awareness: provider.awareness,
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
      destroy() {
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', onNetwork);
          window.removeEventListener('offline', onNetwork);
        }
        provider.awareness.off('change', emitStatus);
        statusFns.clear();
        syncedFns.clear();
        provider.destroy();
        doc.destroy();
      },
    };
  };
}
