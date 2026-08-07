/** The write gate — a pure decision function for the contract's lock (`docs/contract.md`
 *  §3.4). No timers/DOM/`Date.now()` inside; time-dependent inputs arrive pre-computed
 *  (`aloneSettled`, `withinDepartureLinger`) — same split as `roomLock.ts` / `leader.ts`. */

import type { RoomPresence } from './types.js';
import { PresenceKind, SessionRole, Transport } from './types.js';

/** The user's explicit "Write alone anyway" choice — never a bare boolean. */
export type SoloOptIn = boolean & { readonly _brand: 'SoloOptIn' };

/** How long presence must stay `Alone` before the gate may lock, per transport
 *  (docs/contract.md §2.1 — the transport with the better detection gets to
 *  trust its own "alone" faster). The hub's registry is authoritative, so a
 *  settled hub absence is trustworthy almost immediately. P2P discovery is
 *  one-directional and never retried — a slow announce must not read as a
 *  locked-out room, so it waits substantially longer before concluding alone. */
export const GATE_SETTLE_HUB_MS = 1_500;
export const GATE_SETTLE_P2P_MS = 6_000;

export function gateSettleMs(transport: Transport): number {
  return transport === Transport.Hub ? GATE_SETTLE_HUB_MS : GATE_SETTLE_P2P_MS;
}

/** How long after a peer's departure the room still counts as "just left", per
 *  transport. The hub's own awareness registry can keep reporting a departed
 *  peer as present for up to ~30s (y-protocols' `outdatedTimeout` sweep) —
 *  hub linger must cover that window or the gate would lock while the
 *  server's own list hasn't caught up, so it's a correction, not a courtesy.
 *  P2P's peer-close event is immediate and reliable, so its linger is a much
 *  shorter grace window for a mid-sentence writer, not a wait for stale data
 *  to expire. */
export const GATE_LINGER_HUB_MS = 30_000;
export const GATE_LINGER_P2P_MS = 3_000;

export function gateLingerMs(transport: Transport): number {
  return transport === Transport.Hub ? GATE_LINGER_HUB_MS : GATE_LINGER_P2P_MS;
}

export interface WriteGateInput {
  readonly role: SessionRole;
  readonly presence: RoomPresence;
  /** This deployment can never sync across devices, so gating would be a dead end. */
  readonly collabUnavailable: boolean;
  /** P2P only — the wiring layer never sets this on the hub. */
  readonly soloOptIn: SoloOptIn;
  /** Branch (b): a storage backend of the user's own durably keeps this room. */
  readonly savedHere: boolean;
  /** True once the current `Alone` presence has held for `gateSettleMs(transport)`;
   *  ignored outside `presence.kind === Alone`. */
  readonly aloneSettled: boolean;
  /** True while still within `gateLingerMs(transport)` of a peer's departure. */
  readonly withinDepartureLinger: boolean;
}

export interface WriteGateOpen {
  readonly status: 'open';
}
export interface WriteGateHeld {
  readonly status: 'held';
}
/** Discriminated union — never a bare boolean (AGENTS.md "screaming names"). */
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
