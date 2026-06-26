import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

/** Whether a peer may edit the document in this session. */
export type SessionRole = 'writer' | 'reader';

/** A collaboration room identifier, derived from the URL or generated randomly. */
export type RoomId = string & { readonly _brand: 'RoomId' };

/** A WebRTC signaling server URL (`ws://`/`wss://`) that has passed
 *  `resolveSignaling()` validation — peers use it only to discover each other. */
export type SignalingUrl = string & { readonly _brand: 'SignalingUrl' };

/** A y-websocket hub URL (`ws://`/`wss://`) that has passed `resolveWebsocket()`
 *  validation — the central relay that carries edits on the hub transport. */
export type WebsocketUrl = string & { readonly _brand: 'WebsocketUrl' };

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

/**
 * Transport-level connection status, surfaced to the UI status pill.
 *
 * - `connecting` — not yet attached to a signaling server.
 * - `waiting`    — attached to signaling but no peer is present yet (you're
 *                  alone in the room; share the link to collaborate).
 * - `connected`  — at least one peer is present, so edits flow in real time.
 * - `offline`    — the browser reports no network connection.
 */
export type ConnStatus = 'connecting' | 'waiting' | 'connected' | 'offline';

/**
 * Which kind of transport backs a `Collab` session:
 * - `p2p` — WebRTC, edits travel peer-to-peer (no server in the data path).
 * - `hub` — y-websocket, edits are relayed through a central server.
 * Surfaced in the UI so a user knows whether the server sees their content.
 */
export type Transport = 'p2p' | 'hub';

export interface Collab {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  /** The transport kind backing this session (for UI display). */
  readonly transport: Transport;
  /** Subscribe to transport connection status. Fires immediately with the
   *  current value, then on every change. Returns an unsubscribe function. */
  onStatus(fn: (status: ConnStatus) => void): () => void;
  /** Subscribe to whether the doc has synced with at least one peer. Fires
   *  immediately, then on every change. Returns an unsubscribe function. */
  onSynced(fn: (synced: boolean) => void): () => void;
  destroy(): void;
}

export type CollabConnect = (room: RoomId) => Collab;

const FALLBACK_NAME = 'Anonymous' as DisplayName;
const FALLBACK_COLOR = '#888888' as CursorColor;

/**
 * Parse an unknown awareness state value arriving from a peer browser.
 * All field access is guarded — malformed peer data produces safe fallbacks.
 * This is the single cast site for DisplayName and CursorColor from network data.
 */
export function parsePeerAwarenessState(raw: unknown): PeerAwarenessState {
  const obj = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};
  const user = (typeof obj['user'] === 'object' && obj['user'] !== null)
    ? obj['user'] as Record<string, unknown>
    : {};
  const nameRaw = user['name'];
  const colorRaw = user['color'];
  const name: DisplayName = (typeof nameRaw === 'string' && nameRaw.trim())
    ? nameRaw.trim() as DisplayName
    : FALLBACK_NAME;
  const color: CursorColor = (typeof colorRaw === 'string' && /^#[0-9a-fA-F]{6}$/.test(colorRaw))
    ? colorRaw as CursorColor
    : FALLBACK_COLOR;
  const role: SessionRole = obj['role'] === 'reader' ? 'reader' : 'writer';
  const canPersist = obj['canPersist'] === true;
  return { user: { name, color }, role, canPersist };
}
