import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

/** Whether a peer may edit the document in this session. */
export type SessionRole = 'writer' | 'reader';

/** The name a peer chose to display next to their cursor. */
export type DisplayName = string & { readonly _brand: 'DisplayName' };

/** A CSS colour string (e.g. `#e11d48`) used to render peer cursors. */
export type CursorColor = string & { readonly _brand: 'CursorColor' };

/** Display identity of a peer, consumed by yCursorPlugin. */
export interface PeerUser {
  readonly name: DisplayName;
  readonly color: CursorColor;
}

/**
 * The full awareness state broadcast by each peer.
 *
 * - `user`       — display identity (name + cursor colour).
 * - `role`       — whether this peer may edit locally (cooperative, not enforced).
 * - `canPersist` — whether this peer has authenticated storage access with at
 *                  least write permission. Only `canPersist` peers participate
 *                  in leader election for autosave relay.
 */
export interface PeerAwarenessState {
  readonly user: PeerUser;
  readonly role: SessionRole;
  readonly canPersist: boolean;
}

export interface Collab {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  destroy(): void;
}

export type CollabConnect = (room: string) => Collab;
