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

/** A STUN server URL validated by `parseStunUrl()` in `parse.ts`. STUN only
 *  reveals a peer's public address; it never carries media. */
export type StunUrl = string & { readonly _brand: 'StunUrl' };

/** A TURN relay URL validated by `parseTurnUrl()` in `parse.ts`. TURN relays
 *  media when direct/STUN paths fail (carrier / symmetric NAT). */
export type TurnUrl = string & { readonly _brand: 'TurnUrl' };

/** TURN long-term credential username, cast from user input at the Settings
 *  form boundary by `parseTurnUsername()` in `parse.ts`. */
export type TurnUsername = string & { readonly _brand: 'TurnUsername' };

/** TURN long-term credential secret, cast from user input at the Settings
 *  form boundary by `parseTurnCredential()` in `parse.ts`. */
export type TurnCredential = string & { readonly _brand: 'TurnCredential' };

/**
 * Controls which public TURN fallback (if any) is used when no custom TURN
 * relay is configured. Richer than a boolean so future relay options can be
 * added without a breaking change.
 *
 * - `'openrelay'` — use the bundled public OpenRelay (best-effort, free tier).
 * - `'none'`      — no fallback; peers on restrictive NATs may fail to connect.
 */
export type FallbackTurnPolicy = 'openrelay' | 'none';

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

/** Identifier of a single peer connection, taken from the WebRTC layer's
 *  connection map — branded so it can't be confused with any other id string. */
export type PeerConnId = string & { readonly _brand: 'PeerConnId' };

/** How a single peer connection is carried — surfaced in the diagnostics panel. */
export interface PeerConnectionInfo {
  readonly id: PeerConnId;
  /** `direct` = host/srflx candidate; `relay` = routed through a TURN server. */
  readonly type: 'direct' | 'relay' | 'unknown';
}

/** A snapshot of the live connection, for the diagnostics panel. */
export interface Diagnostics {
  readonly transport: Transport;
  /** Attached to the signaling / collaboration server. */
  readonly signaling: boolean;
  readonly peers: number;
  /** Per-peer carriage (WebRTC only; empty for the hub). */
  readonly connections: PeerConnectionInfo[];
}

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
  /** Force a transport reconnect (drop + re-attach). */
  reconnect?(): void;
  /** Snapshot the live connection for the diagnostics panel. */
  getDiagnostics?(): Promise<Diagnostics>;
  destroy(): void;
}

export type CollabConnect = (room: RoomId) => Collab;

