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
import { ConnStatus, Transport } from './types.js';
import type { Diagnostics } from './types.js';

/** Diagnostics access for the connection dialog — present only while a session
 *  is live, and only on transports that expose it (WebRTC). */
export interface SessionDiagnostics {
  readonly transport: Transport;
  readonly getDiagnostics?: () => Promise<Diagnostics>;
  readonly reconnect?: () => void;
}

let conn = $state<ConnStatus>(ConnStatus.Connecting);
let saveStatus = $state<SaveStatus>(SaveStatus.Idle);
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
// True once the document has been scrolled down past a small threshold — read
// by the mobile header (App.svelte) to collapse itself out of the way, then
// reappear the moment the user scrolls back up or returns to the top. See
// Editor.svelte's scroll tracking on `.content`. Irrelevant on desktop, where
// the header never collapses.
let scrollHidden = $state(false);

/** Reactive accessor read by the header. */
export const sessionState = {
  get conn(): ConnStatus {
    return conn;
  },
  get saveStatus(): SaveStatus {
    return saveStatus;
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
  get scrollHidden(): boolean {
    return scrollHidden;
  },
};

export function setSessionConn(value: ConnStatus): void {
  conn = value;
}
export function setSessionSave(value: SaveStatus): void {
  saveStatus = value;
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
export function setSessionScrollHidden(value: boolean): void {
  scrollHidden = value;
}

/** Restore defaults when the Editor unmounts (room change / teardown). */
export function resetSessionState(): void {
  conn = ConnStatus.Connecting;
  saveStatus = SaveStatus.Idle;
  users = [];
  peers = 1;
  diag = { transport: Transport.P2P };
  editing = false;
  jumpToPeer = undefined;
  scrollHidden = false;
}
