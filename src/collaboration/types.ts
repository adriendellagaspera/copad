import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { BrowserId } from './browserId.js';
import type { SelfProbeMarker } from './selfProbeMarker.js';

export const SessionRole = { Writer: 'writer', Reader: 'reader' } as const;
export type SessionRole = (typeof SessionRole)[keyof typeof SessionRole];

/** A room's immutable identity — never changed by a rename. */
export type RoomId = string & { readonly _brand: 'RoomId' };

/** Editable display name for a room; changing it never affects {@link RoomId}. */
export type RoomName = string & { readonly _brand: 'RoomName' };

/** A room's full navigable URL: path, `?room=`/`?role=` query, and the `#k=`
 *  secret-link fragment when the room is encrypted. Persisted by recent-docs
 *  (`src/collaboration/recentDocs.ts`) so a saved entry can be reopened later
 *  without reconstructing the fragment from parts. Cast only in `parse.ts`. */
export type RoomUrl = string & { readonly _brand: 'RoomUrl' };

/** A WebRTC signaling server URL validated by `resolveSignaling()`. */
export type SignalingUrl = string & { readonly _brand: 'SignalingUrl' };

/** HTTP(S) form of a {@link SignalingUrl} (ws→http, wss→https), used only for
 *  keep-alive GETs that stop a spin-down-on-idle host (e.g. Render free tier)
 *  from sleeping — never carries signaling traffic. */
export type SignalingPingUrl = string & { readonly _brand: 'SignalingPingUrl' };

/** A y-websocket hub URL validated by `resolveWebsocket()`. */
export type WebsocketUrl = string & { readonly _brand: 'WebsocketUrl' };

/** A STUN server URL validated by `parseStunUrl()`. STUN only reveals a
 *  peer's public address; it never carries media. */
export type StunUrl = string & { readonly _brand: 'StunUrl' };

/** A TURN relay URL validated by `parseTurnUrl()`; relays media when
 *  direct/STUN paths fail. */
export type TurnUrl = string & { readonly _brand: 'TurnUrl' };

/** STUN or TURN descriptor. Structurally compatible with `RTCIceServer`
 *  (branded strings extend `string`), so it passes straight to WebRTC APIs. */
export interface IceServer {
  readonly urls: (StunUrl | TurnUrl)[];
  readonly username?: TurnUsername;
  readonly credential?: TurnCredential;
}

/** HTTPS endpoint returning ICE servers as JSON, e.g. a Cloudflare TURN
 *  credentials Worker minting short-lived creds — keeps the provider's real
 *  API token server-side. Validated by `parseIceServersUrl()`. */
export type IceServersUrl = string & { readonly _brand: 'IceServersUrl' };

/** TURN username, cast from user input at the Settings form boundary. */
export type TurnUsername = string & { readonly _brand: 'TurnUsername' };

/** TURN credential, cast from user input at the Settings form boundary. */
export type TurnCredential = string & { readonly _brand: 'TurnCredential' };

/**
 * Richer than a boolean so future relay options can be added without a
 * breaking change.
 * - `'openrelay'` — bundled public OpenRelay (best-effort, free tier).
 * - `'none'`      — no fallback; peers on restrictive NATs may fail to connect.
 */
export const FallbackTurnPolicy = { OpenRelay: 'openrelay', None: 'none' } as const;
export type FallbackTurnPolicy = (typeof FallbackTurnPolicy)[keyof typeof FallbackTurnPolicy];

export type DisplayName = string & { readonly _brand: 'DisplayName' };
export type CursorColor = string & { readonly _brand: 'CursorColor' };

export interface PeerUser {
  readonly name: DisplayName;
  readonly color: CursorColor;
}

/**
 * Opaque key identifying the physical file a peer persists to, scoping
 * leader election: peers sharing a target elect a single writer, peers with
 * distinct targets each persist independently. A hash of (browser install id
 * + backend id + filename) so the actual location never travels in
 * awareness. Built by `persistTargetKey()` in `leader.ts`.
 */
export type PersistTarget = string & { readonly _brand: 'PersistTarget' };

/**
 * The full awareness state broadcast by each peer.
 *
 * - `canPersist` — has authenticated storage access with at least write
 *                  permission; only these peers join leader election.
 * - `persistTarget` — the file this peer would write to; leader election is
 *                  scoped to it. Absent when not persisting.
 * - `browserId`  — this peer's `browserId()`, so a second tab of one's own
 *                  browser is distinguishable from a stranger's.
 * - `selfProbeMarker` — present only on the tab a `MeetingJoinDialog` join
 *                  just opened, so `presenceProbe.ts` can recognize and
 *                  discard its own self-join instead of reading it as a peer.
 */
export interface PeerAwarenessState {
  readonly user: PeerUser;
  readonly role: SessionRole;
  readonly canPersist: boolean;
  readonly persistTarget?: PersistTarget;
  readonly browserId?: BrowserId;
  readonly selfProbeMarker?: SelfProbeMarker;
}

/**
 * Transport-level connection status, surfaced to the UI status pill.
 * - `connecting`   — not yet attached; within the grace window (`CONNECT_TIMEOUT_MS`).
 * - `unreachable`  — still not attached after the grace window elapsed.
 * - `waiting`      — attached, but no peer present yet.
 * - `connected`    — at least one peer present.
 * - `offline`      — the browser reports no network connection.
 */
export const ConnStatus = {
  Connecting: 'connecting',
  Unreachable: 'unreachable',
  Waiting: 'waiting',
  Connected: 'connected',
  Offline: 'offline',
} as const;
export type ConnStatus = (typeof ConnStatus)[keyof typeof ConnStatus];

/**
 * Whether branch (a) of the contract — "someone is here" — currently holds.
 * Beside {@link ConnStatus}, never replacing it. `reaching` is a
 * discovered-but-unconnected peer: proven present, never locks.
 */
export const PresenceKind = {
  Unknown: 'unknown',
  Reaching: 'reaching',
  Alone: 'alone',
  Accompanied: 'accompanied',
} as const;
export type PresenceKind = (typeof PresenceKind)[keyof typeof PresenceKind];

/** Emitters must memoise this by `kind`; see `core.ts`. */
export interface RoomPresence {
  readonly kind: PresenceKind;
}

/**
 * - `p2p` — WebRTC, edits travel peer-to-peer (no server in the data path).
 * - `hub` — y-websocket, edits are relayed through a central server.
 */
export const Transport = { P2P: 'p2p', Hub: 'hub' } as const;
export type Transport = (typeof Transport)[keyof typeof Transport];

export type PeerConnId = string & { readonly _brand: 'PeerConnId' };

/** `'unknown'` means stats are unavailable or the PC is still negotiating. */
export const IceCandidateType = { Direct: 'direct', Relay: 'relay', Unknown: 'unknown' } as const;
export type IceCandidateType = (typeof IceCandidateType)[keyof typeof IceCandidateType];

export interface PeerConnectionInfo {
  readonly id: PeerConnId;
  readonly type: IceCandidateType;
}

export interface Diagnostics {
  readonly transport: Transport;
  readonly signaling: boolean;
  readonly peers: number;
  /** Per-peer carriage; WebRTC only, empty for the hub. */
  readonly connections: PeerConnectionInfo[];
}

export interface Collab {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly transport: Transport;
  /** Fires immediately with the current value, then on every change. */
  onStatus(fn: (status: ConnStatus) => void): () => void;
  /** Fires immediately with the current value, then on every change. */
  onSynced(fn: (synced: boolean) => void): () => void;
  /** Optional; absence means `Unknown`. */
  onPresence?(fn: (presence: RoomPresence) => void): () => void;
  reconnect?(): void;
  getDiagnostics?(): Promise<Diagnostics>;
  destroy(): void;
}

export type CollabConnect = (room: RoomId) => Collab;
