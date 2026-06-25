import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Collab, CollabConnect, ConnStatus, RoomId } from './types.js';

export function webrtcCollab(opts: {
  signaling: string[];
  password?: string;
}): CollabConnect {
  return (room: RoomId): Collab => {
    const doc = new Y.Doc();
    // RoomId extends string — cast back to string at the y-webrtc IO boundary.
    const webrtc = new WebrtcProvider(room as string, doc, {
      signaling: opts.signaling,
      password: opts.password,
    });

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
        statusFns.clear();
        syncedFns.clear();
        webrtc.destroy();
        doc.destroy();
      },
    };
  };
}
