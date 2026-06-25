import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

/** Whether a peer may edit the document in this session. */
export type SessionRole = 'writer' | 'reader';

/** A collaboration room identifier, derived from the URL or generated randomly. */
export type RoomId = string & { readonly _brand: 'RoomId' };

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

/** Transport-level connection status, surfaced to the UI status pill. */
export type ConnStatus = 'connecting' | 'connected' | 'offline';

export interface Collab {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  /** Subscribe to transport connection status. Fires immediately with the
   *  current value, then on every change. Returns an unsubscribe function. */
  onStatus(fn: (status: ConnStatus) => void): () => void;
  /** Subscribe to whether the doc has synced with at least one peer. Fires
   *  immediately, then on every change. Returns an unsubscribe function. */
  onSynced(fn: (synced: boolean) => void): () => void;
  destroy(): void;
}

export type CollabConnect = (room: RoomId) => Collab;
