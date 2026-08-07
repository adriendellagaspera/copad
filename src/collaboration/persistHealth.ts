/**
 * Branch (b)'s state machine (docs/contract.md §3.2/§3.3) — constates what a real
 * `save()`/`load()` observed, never predicts or decays with time. Pure, no clock
 * reads: the caller supplies `now` (same split as writeGate.ts / roomLock.ts / leader.ts).
 */

import { WriteFailureKind, WriteLanding, type WriteReceipt } from '../storage/writeOutcome.js';
import type { EpochMs } from '../time.js';

export const PersistHealthKind = {
  Unproven: 'unproven',
  Proven: 'proven',
  Failing: 'failing',
  Broken: 'broken',
} as const;
export type PersistHealthKind = (typeof PersistHealthKind)[keyof typeof PersistHealthKind];

export type PersistHealth =
  | { readonly kind: typeof PersistHealthKind.Unproven }
  | { readonly kind: typeof PersistHealthKind.Proven; readonly at: EpochMs }
  | { readonly kind: typeof PersistHealthKind.Failing; readonly streak: number }
  | {
      readonly kind: typeof PersistHealthKind.Broken;
      readonly since: EpochMs;
      readonly cause: WriteFailureKind;
    };

export const UNPROVEN: PersistHealth = { kind: PersistHealthKind.Unproven };

/** Consecutive non-terminal failures before `Failing` escalates to `Broken`. */
export const WRITE_FAIL_STREAK = 3;

/** Terminal on the first occurrence — the world told us no, no streak needed. */
const LOCKING_KINDS: ReadonlySet<WriteFailureKind> = new Set([
  WriteFailureKind.Denied,
  WriteFailureKind.Missing,
  WriteFailureKind.Rejected,
]);

export type WriteOutcome =
  | { readonly ok: true; readonly receipt: WriteReceipt }
  | { readonly ok: false; readonly kind: WriteFailureKind };

/** `now` is a timestamp, not a duration — freshness plays no part in this machine. */
export function nextPersistHealth(current: PersistHealth, outcome: WriteOutcome, now: EpochMs): PersistHealth {
  if (outcome.ok) {
    if (outcome.receipt.landing === WriteLanding.Landed) {
      return { kind: PersistHealthKind.Proven, at: now };
    }
    // Coalesced: another write is already in flight and will produce its own receipt.
    return current;
  }
  if (LOCKING_KINDS.has(outcome.kind)) {
    return { kind: PersistHealthKind.Broken, since: now, cause: outcome.kind };
  }
  const streak = current.kind === PersistHealthKind.Failing ? current.streak + 1 : 1;
  if (streak >= WRITE_FAIL_STREAK) {
    return { kind: PersistHealthKind.Broken, since: now, cause: outcome.kind };
  }
  return { kind: PersistHealthKind.Failing, streak };
}

/** The boundary is an event (the first local edit this session), not a clock. */
export const PersistRegime = { Cold: 'cold', Warm: 'warm' } as const;
export type PersistRegime = (typeof PersistRegime)[keyof typeof PersistRegime];

/** Narrowed from a ProseMirror `Transaction` at the call site (`Editor.svelte`) so this
 *  stays testable without a ProseMirror/y-prosemirror runtime. `isChangeOrigin` is
 *  y-prosemirror's own meta key marking a transaction synthesized from a remote Y update. */
export interface LocalEditSignal {
  readonly docChanged: boolean;
  readonly isChangeOrigin: boolean;
}

/**
 * Cold → Warm on this user's own first doc-changing transaction; Warm is absorbing
 * for the rest of the session (docs/contract.md §3.3 — the boundary is an event,
 * not a clock, and never un-happens once there is something to lose).
 */
export function nextRegime(current: PersistRegime, signal: LocalEditSignal): PersistRegime {
  if (current === PersistRegime.Warm) return current;
  return signal.docChanged && !signal.isChangeOrigin ? PersistRegime.Warm : current;
}

/**
 * `durabilityHolds = savedHere && (health ∈ {Proven, Unproven, Failing} || regime === Warm)`
 * — false only when `savedHere` and the room is `Broken ∧ Cold` (`docs/contract.md` §3.4).
 */
export function durabilityHolds(savedHere: boolean, health: PersistHealth, regime: PersistRegime): boolean {
  if (!savedHere) return false;
  if (health.kind !== PersistHealthKind.Broken) return true;
  return regime === PersistRegime.Warm;
}
