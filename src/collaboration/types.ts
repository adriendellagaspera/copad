import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

/** Whether a peer may edit the document in this session. */
export const SessionRole = { Writer: 'writer', Reader: 'reader' } as const;
export type SessionRole = (typeof SessionRole)[keyof typeof SessionRole];

/** A collaboration room identifier, derived from the URL or generated randomly.
 *  This is the room's immutable identity — it is never changed by a rename. */
export type RoomId = string & { readonly _brand: 'RoomId' };

/** A human-friendly, editable display name for a room. Collaborative metadata
 *  stored in the shared Y.Doc; it can be changed freely and NEVER affects the
 *  immutable {@link RoomId}, so renaming a room can't "lose" it. */
export type RoomName = string & { readonly _brand: 'RoomName' };

/** A room the user has visited, remembered locally so the room switcher can
 *  offer it again — the anti-loss safety net. `name` is the last-known shared
 *  name (may be null before it has loaded/been set); `visitedAt` is epoch ms. */
export interface RecentRoom {
  readonly id: RoomId;
  readonly name: RoomName | null;
  readonly visitedAt: number;
}

/** A WebRTC signaling server URL (`ws://`/`wss://`) that has passed
 *  `resolveSignaling()` validation — peers use it only to discover each other. */
export type SignalingUrl = string & { readonly _brand: 'SignalingUrl' };

/** The HTTP(S) URL of a signaling server, derived from a {@link SignalingUrl}
 *  by swapping `ws→http` / `wss→https`. Used only for keep-alive GETs that stop
 *  a spin-down-on-idle host (e.g. Render free tier) from sleeping; never carries
 *  signaling traffic itself. */
export type SignalingPingUrl = string & { readonly _brand: 'SignalingPingUrl' };

/** A y-websocket hub URL (`ws://`/`wss://`) that has passed `resolveWebsocket()`
 *  validation — the central relay that carries edits on the hub transport. */
export type WebsocketUrl = string & { readonly _brand: 'WebsocketUrl' };

/** A STUN server URL validated by `parseStunUrl()` in `parse.ts`. STUN only
 *  reveals a peer's public address; it never carries media. */
export type StunUrl = string & { readonly _brand: 'StunUrl' };

/** A TURN relay URL validated by `parseTurnUrl()` in `parse.ts`. TURN relays
 *  media when direct/STUN paths fail (carrier / symmetric NAT). */
export type TurnUrl = string & { readonly _brand: 'TurnUrl' };

/** An ICE server descriptor — STUN or TURN — in a domain-typed form.
 *  Structurally compatible with `RTCIceServer` (branded strings extend `string`)
 *  so it passes straight through to WebRTC APIs without conversion. */
export interface IceServer {
  readonly urls: (StunUrl | TurnUrl)[];
  readonly username?: TurnUsername;
  readonly credential?: TurnCredential;
}

/** An HTTPS endpoint that returns ICE servers as JSON (`{ iceServers: [...] }`),
 *  e.g. a Cloudflare TURN credentials Worker that mints short-lived credentials.
 *  Lets the provider's real API token stay server-side while the browser only
 *  ever receives ephemeral creds. Validated/branded by `parseIceServersUrl()`. */
export type IceServersUrl = string & { readonly _brand: 'IceServersUrl' };

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
export const FallbackTurnPolicy = { OpenRelay: 'openrelay', None: 'none' } as const;
export type FallbackTurnPolicy = (typeof FallbackTurnPolicy)[keyof typeof FallbackTurnPolicy];

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
export const ConnStatus = {
  Connecting: 'connecting',
  Waiting: 'waiting',
  Connected: 'connected',
  Offline: 'offline',
} as const;
export type ConnStatus = (typeof ConnStatus)[keyof typeof ConnStatus];

/**
 * Which kind of transport backs a `Collab` session:
 * - `p2p` — WebRTC, edits travel peer-to-peer (no server in the data path).
 * - `hub` — y-websocket, edits are relayed through a central server.
 * Surfaced in the UI so a user knows whether the server sees their content.
 */
export const Transport = { P2P: 'p2p', Hub: 'hub' } as const;
export type Transport = (typeof Transport)[keyof typeof Transport];

/** Identifier of a single peer connection, taken from the WebRTC layer's
 *  connection map — branded so it can't be confused with any other id string. */
export type PeerConnId = string & { readonly _brand: 'PeerConnId' };

/** Whether a peer connection is carried directly (host/srflx candidate) or
 *  via a TURN relay. `'unknown'` means stats are unavailable or the PC is still
 *  negotiating. Single source of truth — used by both `IceStatsReader` and
 *  `PeerConnectionInfo`. */
export const IceCandidateType = { Direct: 'direct', Relay: 'relay', Unknown: 'unknown' } as const;
export type IceCandidateType = (typeof IceCandidateType)[keyof typeof IceCandidateType];

/** How a single peer connection is carried — surfaced in the diagnostics panel. */
export interface PeerConnectionInfo {
  readonly id: PeerConnId;
  readonly type: IceCandidateType;
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

