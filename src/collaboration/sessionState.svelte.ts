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
import type { Diagnostics, RoomPresence, ClientId } from './types.js';
import { UNPROVEN, PersistRegime, type PersistHealth } from './persistHealth.js';
import type { EpochMs } from '../time.js';

/** Every accompanying peer shares this browser's id — a second tab, not a stranger. */
export type SoloBrowser = boolean & { readonly _brand: 'SoloBrowser' };

/** The document is still a single empty block: a blank page, whoever blanked it. */
export type DocEmpty = boolean & { readonly _brand: 'DocEmpty' };

/** The ProseMirror content holds DOM focus. */
export type EditorFocused = boolean & { readonly _brand: 'EditorFocused' };

/** Clients the room's awareness reports, self included. */
export type PeerCount = number & { readonly _brand: 'PeerCount' };

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
let soloBrowser = $state<SoloBrowser>(false as SoloBrowser);
let saveStatus = $state<SaveStatus>(SaveStatus.Idle);
// Branch (b)'s state machine (docs/contract.md §3.2/§3.3, persistHealth.ts).
let persistHealth = $state<PersistHealth>(UNPROVEN);
let regime = $state<PersistRegime>(PersistRegime.Cold);
// Repeats on every keystroke, unlike the one-way `regime` latch: extends the departure linger (contract §4).
let lastLocalEditAt = $state<EpochMs | null>(null);
let docEmpty = $state<DocEmpty>(true as DocEmpty);
let users = $state<PeerUser[]>([]);
let peers = $state<PeerCount>(1 as PeerCount);
let diag = $state<SessionDiagnostics>({ transport: Transport.P2P });
let editing = $state<EditorFocused>(false as EditorFocused);
let jumpToPeer = $state<((clientId: ClientId) => void) | undefined>(undefined);

/** Reactive accessor read by the header. */
export const sessionState = {
  get conn(): ConnStatus {
    return conn;
  },
  get presence(): RoomPresence {
    return presence;
  },
  get soloBrowser(): SoloBrowser {
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
  get lastLocalEditAt(): EpochMs | null {
    return lastLocalEditAt;
  },
  get docEmpty(): DocEmpty {
    return docEmpty;
  },
  get users(): PeerUser[] {
    return users;
  },
  get peers(): PeerCount {
    return peers;
  },
  get diagnostics(): SessionDiagnostics {
    return diag;
  },
  get editing(): EditorFocused {
    return editing;
  },
  get jumpToPeer(): ((clientId: ClientId) => void) | undefined {
    return jumpToPeer;
  },
};

export function setSessionConn(value: ConnStatus): void {
  conn = value;
}
export function setSessionRoomPresence(value: RoomPresence): void {
  presence = value;
}
export function setSessionSoloBrowser(value: SoloBrowser): void {
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
export function setSessionLocalEdit(value: EpochMs): void {
  lastLocalEditAt = value;
}
export function setSessionDocEmpty(value: DocEmpty): void {
  docEmpty = value;
}
export function setSessionPresence(nextUsers: PeerUser[], nextPeers: PeerCount): void {
  users = nextUsers;
  peers = nextPeers;
}
export function setSessionDiagnostics(value: SessionDiagnostics): void {
  diag = value;
}
export function setSessionEditing(value: EditorFocused): void {
  editing = value;
}
export function setSessionJumpToPeer(value: ((clientId: ClientId) => void) | undefined): void {
  jumpToPeer = value;
}

/** Restore defaults when the Editor unmounts (room change / teardown). */
export function resetSessionState(): void {
  conn = ConnStatus.Connecting;
  presence = { kind: PresenceKind.Unknown };
  soloBrowser = false as SoloBrowser;
  saveStatus = SaveStatus.Idle;
  persistHealth = UNPROVEN;
  regime = PersistRegime.Cold;
  lastLocalEditAt = null;
  docEmpty = true as DocEmpty;
  users = [];
  peers = 1 as PeerCount;
  diag = { transport: Transport.P2P };
  editing = false as EditorFocused;
  jumpToPeer = undefined;
}
