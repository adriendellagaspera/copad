// A module-level holder works because only one Editor is mounted at a time.

import type { PeerUser } from '../ui/types.js';
import { SaveStatus } from '../ui/types.js';
import { ConnStatus, PresenceKind, Transport } from './types.js';
import type { Diagnostics, RoomPresence, ClientId } from './types.js';
import { UNPROVEN, PersistRegime, type PersistHealth } from './persistHealth.js';
import type { EpochMs } from '../time.js';

/** Every accompanying peer shares this browser's id — a second tab, not a stranger. */
export type SoloBrowser = boolean & { readonly _brand: 'SoloBrowser' };

export type DocEmpty = boolean & { readonly _brand: 'DocEmpty' };

export type EditorFocused = boolean & { readonly _brand: 'EditorFocused' };

/** Self included. */
export type PeerCount = number & { readonly _brand: 'PeerCount' };

export interface SessionDiagnostics {
  readonly transport: Transport;
  readonly getDiagnostics?: () => Promise<Diagnostics>;
  readonly reconnect?: () => void;
}

let conn = $state<ConnStatus>(ConnStatus.Connecting);
// Unknown by default: never lock on ignorance (docs/contract.md §2.2).
let presence = $state<RoomPresence>({ kind: PresenceKind.Unknown });
let soloBrowser = $state<SoloBrowser>(false as SoloBrowser);
let saveStatus = $state<SaveStatus>(SaveStatus.Idle);
let persistHealth = $state<PersistHealth>(UNPROVEN);
let regime = $state<PersistRegime>(PersistRegime.Cold);
// Repeats on every keystroke, unlike the one-way `regime` latch.
let lastLocalEditAt = $state<EpochMs | null>(null);
let docEmpty = $state<DocEmpty>(true as DocEmpty);
let users = $state<PeerUser[]>([]);
let peers = $state<PeerCount>(1 as PeerCount);
let diag = $state<SessionDiagnostics>({ transport: Transport.P2P });
let editing = $state<EditorFocused>(false as EditorFocused);
let jumpToPeer = $state<((clientId: ClientId) => void) | undefined>(undefined);

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
