import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import type { Collab, CollabConnect } from './types.js';

export function webrtcCollab(opts: {
  signaling: string[];
  password?: string;
}): CollabConnect {
  return (room: string): Collab => {
    const doc = new Y.Doc();
    const webrtc = new WebrtcProvider(room, doc, {
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
