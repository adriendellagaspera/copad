// Shared reactive bridge for session-level collaboration state.
//
// Connection status, presence, save status and transport diagnostics are all
// derived from the `collab` instance the Editor owns — but they are now shown in
// App's header, which sits outside the {#key room} Editor block. Same pattern as
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

/** Restore defaults when the Editor unmounts (room change / teardown). */
export function resetSessionState(): void {
  conn = ConnStatus.Connecting;
  saveStatus = SaveStatus.Idle;
  users = [];
  peers = 1;
  diag = { transport: Transport.P2P };
}
