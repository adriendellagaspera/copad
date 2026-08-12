import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { BrowserId } from './browserId.js';
import type { SelfProbeMarker } from './selfProbeMarker.js';

export const SessionRole = { Writer: 'writer', Reader: 'reader' } as const;
export type SessionRole = (typeof SessionRole)[keyof typeof SessionRole];

export type RoomId = string & { readonly _brand: 'RoomId' };
export type RoomName = string & { readonly _brand: 'RoomName' };
export type SignalingUrl = string & { readonly _brand: 'SignalingUrl' };

// Never carries signaling traffic — only keep-alive GETs that stop a spin-down-on-idle host (e.g. Render free tier) from sleeping.
export type SignalingPingUrl = string & { readonly _brand: 'SignalingPingUrl' };

export type WebsocketUrl = string & { readonly _brand: 'WebsocketUrl' };
export type StunUrl = string & { readonly _brand: 'StunUrl' };
export type TurnUrl = string & { readonly _brand: 'TurnUrl' };

// Structurally compatible with RTCIceServer (branded strings extend string), so it passes straight to WebRTC APIs.
export interface IceServer {
  readonly urls: (StunUrl | TurnUrl)[];
  readonly username?: TurnUsername;
  readonly credential?: TurnCredential;
}

export type IceServersUrl = string & { readonly _brand: 'IceServersUrl' };
export type TurnUsername = string & { readonly _brand: 'TurnUsername' };
export type TurnCredential = string & { readonly _brand: 'TurnCredential' };

// Richer than a boolean so future relay options can be added without a breaking change.
export const FallbackTurnPolicy = { OpenRelay: 'openrelay', None: 'none' } as const;
export type FallbackTurnPolicy = (typeof FallbackTurnPolicy)[keyof typeof FallbackTurnPolicy];

export type DisplayName = string & { readonly _brand: 'DisplayName' };
export type CursorColor = string & { readonly _brand: 'CursorColor' };

export interface PeerUser {
  readonly name: DisplayName;
  readonly color: CursorColor;
}

// A hash of (browser install id + backend id + filename), built by persistTargetKey() in leader.ts, so the actual file location never travels in awareness.
export type PersistTarget = string & { readonly _brand: 'PersistTarget' };

// selfProbeMarker is present only on the tab a MeetingJoinDialog join just opened, so presenceProbe.ts can recognize and discard its own self-join instead of reading it as a peer.
export interface PeerAwarenessState {
  readonly user: PeerUser;
  readonly role: SessionRole;
  readonly canPersist: boolean;
  readonly persistTarget?: PersistTarget;
  readonly browserId?: BrowserId;
  readonly selfProbeMarker?: SelfProbeMarker;
}

export const ConnStatus = {
  Connecting: 'connecting',
  Unreachable: 'unreachable',
  Waiting: 'waiting',
  Connected: 'connected',
  Offline: 'offline',
} as const;
export type ConnStatus = (typeof ConnStatus)[keyof typeof ConnStatus];

// Whether contract branch (a), "someone is here", currently holds — beside ConnStatus, never replacing it. `reaching` is a discovered-but-unconnected peer: proven present, never locks.
export const PresenceKind = {
  Unknown: 'unknown',
  Reaching: 'reaching',
  Alone: 'alone',
  Accompanied: 'accompanied',
} as const;
export type PresenceKind = (typeof PresenceKind)[keyof typeof PresenceKind];

// Emitters must memoise this by kind; see core.ts.
export interface RoomPresence {
  readonly kind: PresenceKind;
}

export const Transport = { P2P: 'p2p', Hub: 'hub' } as const;
export type Transport = (typeof Transport)[keyof typeof Transport];

export type PeerConnId = string & { readonly _brand: 'PeerConnId' };

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
  // WebRTC only, empty for the hub.
  readonly connections: PeerConnectionInfo[];
}

export interface Collab {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly transport: Transport;
  // Fires immediately with the current value, then on every change.
  onStatus(fn: (status: ConnStatus) => void): () => void;
  onSynced(fn: (synced: boolean) => void): () => void;
  // Absence means Unknown.
  onPresence?(fn: (presence: RoomPresence) => void): () => void;
  reconnect?(): void;
  getDiagnostics?(): Promise<Diagnostics>;
  destroy(): void;
}

export type CollabConnect = (room: RoomId) => Collab;
