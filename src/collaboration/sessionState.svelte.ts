// Shared reactive bridge for session-level collaboration state.
//
// Connection status, presence, save status and transport diagnostics are all
// derived from the `collab` instance the Editor owns — but they are now shown in
// App's header, which sits outside the Editor block. Same pattern as
// roomName.svelte.ts: the Editor pushes these values as they change; the header
// reads them reactively. Only one Editor is mounted at a time, so a single
// module-level holder is enough; the Editor resets it on teardown.

import type { PeerUser } from '../ui/types.js';
import { SaveStatus } from '../ui/types.js';
import { ConnStatus, PresenceKind, Transport } from './types.js';
import type { Diagnostics, RoomPresence } from './types.js';
import { UNPROVEN, PersistRegime, type PersistHealth } from './persistHealth.js';

/** Diagnostics access for the connection dialog — present only while a session
 *  is live, and only on transports that expose it (WebRTC). */
export interface SessionDiagnostics {
  readonly transport: Transport;
  readonly getDiagnostics?: () => Promise<Diagnostics>;
  readonly reconnect?: () => void;
}

let conn = $state<ConnStatus>(ConnStatus.Connecting);
// Feeds the write gate, not the status pill. Defaults to Unknown: never lock on ignorance.
let presence = $state<RoomPresence>({ kind: PresenceKind.Unknown });
// True while every accompanying peer shares our own browserId — a second tab, not a stranger.
let soloBrowser = $state(false);
let saveStatus = $state<SaveStatus>(SaveStatus.Idle);
// Branch (b)'s state machine (docs/contract.md §3.2/§3.3, persistHealth.ts).
let persistHealth = $state<PersistHealth>(UNPROVEN);
let regime = $state<PersistRegime>(PersistRegime.Cold);
let users = $state<PeerUser[]>([]);
let peers = $state(1);
let diag = $state<SessionDiagnostics>({ transport: Transport.P2P });
// True while the ProseMirror content has DOM focus — read by the mobile header
// to swap its bottom dock between navigation actions and the formatting
// toolbar (see Editor.svelte's focusin/focusout tracking and the M3 mobile
// layout in App.svelte / editor.css). Irrelevant on desktop, where the
// formatting toolbar lives in the floating selection bubble instead.
let editing = $state(false);
// Set by the Editor once its view mounts: scrolls a peer's cursor/selection
// into view and briefly flashes it. Read by the header's presence bar and by
// ConnectionDialog, both of which sit outside the Editor block. Undefined
// while no Editor is mounted (e.g. mid room-switch remount).
let jumpToPeer = $state<((clientId: number) => void) | undefined>(undefined);

/** Reactive accessor read by the header. */
export const sessionState = {
  get conn(): ConnStatus {
    return conn;
  },
  get presence(): RoomPresence {
    return presence;
  },
  get soloBrowser(): boolean {
    return soloBrowser;
  },
  get saveStatus(): SaveStatus {
    return saveStatus;
  },
  get persistHealth(): PersistHealth {
    return persistHealth;
  },
  get regime(): PersistRegime {
    return regime;
  },
  get users(): PeerUser[] {
    return users;
  },
  get peers(): number {
    return peers;
  },
  get diagnostics(): SessionDiagnostics {
    return diag;
  },
  get editing(): boolean {
    return editing;
  },
  get jumpToPeer(): ((clientId: number) => void) | undefined {
    return jumpToPeer;
  },
};

export function setSessionConn(value: ConnStatus): void {
  conn = value;
}
export function setSessionRoomPresence(value: RoomPresence): void {
  presence = value;
}
export function setSessionSoloBrowser(value: boolean): void {
  soloBrowser = value;
}
export function setSessionSave(value: SaveStatus): void {
  saveStatus = value;
}
export function setSessionPersistHealth(value: PersistHealth): void {
  persistHealth = value;
}
export function setSessionRegime(value: PersistRegime): void {
  regime = value;
}
export function setSessionPresence(nextUsers: PeerUser[], nextPeers: number): void {
  users = nextUsers;
  peers = nextPeers;
}
export function setSessionDiagnostics(value: SessionDiagnostics): void {
  diag = value;
}
export function setSessionEditing(value: boolean): void {
  editing = value;
}
export function setSessionJumpToPeer(value: ((clientId: number) => void) | undefined): void {
  jumpToPeer = value;
}

/** Restore defaults when the Editor unmounts (room change / teardown). */
export function resetSessionState(): void {
  conn = ConnStatus.Connecting;
  presence = { kind: PresenceKind.Unknown };
  soloBrowser = false;
  saveStatus = SaveStatus.Idle;
  persistHealth = UNPROVEN;
  regime = PersistRegime.Cold;
  users = [];
  peers = 1;
  diag = { transport: Transport.P2P };
  editing = false;
  jumpToPeer = undefined;
}
