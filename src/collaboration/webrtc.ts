import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Collab, CollabConnect, RoomId } from './types.js';

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
    return {
      doc,
      awareness: webrtc.awareness,
      destroy() {
        webrtc.destroy();
        doc.destroy();
      },
    };
  };
}
