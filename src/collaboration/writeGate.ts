// Pure decision function for the contract's lock (docs/contract.md §3.4). No timers/DOM/Date.now() inside; time-dependent inputs arrive pre-computed, same split as roomLock.ts / leader.ts.

import type { RoomPresence } from './types.js';
import { PresenceKind, SessionRole, Transport } from './types.js';
import type { Milliseconds } from '../time.js';

export type SoloOptIn = boolean & { readonly _brand: 'SoloOptIn' };

// docs/contract.md §2.1: the hub's registry is authoritative, so a settled hub absence is trustworthy almost immediately; P2P discovery is one-directional and never retried, so a slow announce must not read as locked-out — it waits much longer before concluding alone.
export const GATE_SETTLE_HUB_MS = 1_500 as Milliseconds;
export const GATE_SETTLE_P2P_MS = 6_000 as Milliseconds;

// Record, not a ternary: a third Transport without an entry here fails to compile instead of silently falling through.
const SETTLE_MS: Record<Transport, Milliseconds> = {
  [Transport.Hub]: GATE_SETTLE_HUB_MS,
  [Transport.P2P]: GATE_SETTLE_P2P_MS,
};

export function gateSettleMs(transport: Transport): Milliseconds {
  return SETTLE_MS[transport];
}

// Hub linger must cover y-protocols' ~30s outdatedTimeout sweep (a correction, not a courtesy) or the gate would lock before the server's own list catches up; P2P's peer-close event is immediate, so its linger is just a short mid-sentence grace window.
export const GATE_LINGER_HUB_MS = 30_000 as Milliseconds;
export const GATE_LINGER_P2P_MS = 3_000 as Milliseconds;

const LINGER_MS: Record<Transport, Milliseconds> = {
  [Transport.Hub]: GATE_LINGER_HUB_MS,
  [Transport.P2P]: GATE_LINGER_P2P_MS,
};

export function gateLingerMs(transport: Transport): Milliseconds {
  return LINGER_MS[transport];
}

export interface WriteGateInput {
  readonly role: SessionRole;
  readonly presence: RoomPresence;
  readonly collabUnavailable: boolean;
  readonly soloOptIn: SoloOptIn;
  readonly savedHere: boolean;
  // Ignored outside presence.kind === Alone.
  readonly aloneSettled: boolean;
  readonly withinDepartureLinger: boolean;
}

export interface WriteGateOpen {
  readonly status: 'open';
}
export interface WriteGateHeld {
  readonly status: 'held';
}
export type WriteGate = WriteGateOpen | WriteGateHeld;

const OPEN: WriteGateOpen = { status: 'open' };
const HELD: WriteGateHeld = { status: 'held' };

/**
 * Decision rule from `docs/contract.md` §3.4. First match wins.
 * ```
 * Open if any of:
 *   role === Reader           → out of scope, readers were never gated
 *   collabUnavailable         → nobody can ever arrive
 *   soloOptIn                 → explicit, named user choice
 *   presence === Accompanied  → branch (a) holds
 *   presence === Reaching     → someone is here; the failure to reach them is ours
 *   presence === Unknown      → never lock on ignorance
 *   savedHere                 → branch (b) holds
 *   aloneSettled === false    → grace window after becoming Alone
 *   withinDepartureLinger     → hysteresis after a departure
 * Held otherwise.
 * ```
 */
export function writeGateFor(input: WriteGateInput): WriteGate {
  if (input.role === SessionRole.Reader) return OPEN;
  if (input.collabUnavailable) return OPEN;
  if (input.soloOptIn) return OPEN;
  if (input.presence.kind === PresenceKind.Accompanied) return OPEN;
  if (input.presence.kind === PresenceKind.Reaching) return OPEN;
  if (input.presence.kind === PresenceKind.Unknown) return OPEN;
  if (input.savedHere) return OPEN;
  if (input.presence.kind === PresenceKind.Alone && !input.aloneSettled) return OPEN;
  if (input.withinDepartureLinger) return OPEN;
  return HELD;
}
