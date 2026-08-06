/**
 * Branch (b)'s own state machine (`docs/contract.md` §3.2/§3.3). `savedHere` is
 * declarative — configured, logged in, claims this room — and never consults the
 * world. `PersistHealth` *constates* what a real `save()`/`load()` attempt observed;
 * it never predicts or decays with time. Pure, no clock reads — the caller supplies
 * `now` (same split as `writeGate.ts` / `roomLock.ts` / `leader.ts`).
 */

import { WriteFailureKind, WriteLanding, type WriteReceipt } from '../storage/writeOutcome.js';

export const PersistHealthKind = {
  Unproven: 'unproven',
  Proven: 'proven',
  Failing: 'failing',
  Broken: 'broken',
} as const;
export type PersistHealthKind = (typeof PersistHealthKind)[keyof typeof PersistHealthKind];

export type PersistHealth =
  | { readonly kind: typeof PersistHealthKind.Unproven }
  | { readonly kind: typeof PersistHealthKind.Proven; readonly at: number }
  | { readonly kind: typeof PersistHealthKind.Failing; readonly streak: number }
  | {
      readonly kind: typeof PersistHealthKind.Broken;
      readonly since: number;
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

/**
 * Reduces the current health against one observed `save()` outcome. `now` is a
 * timestamp, not a duration — freshness is deliberately not part of this machine
 * (§3.2: "the machine's promise is not 'your backend is healthy'").
 */
export function nextPersistHealth(current: PersistHealth, outcome: WriteOutcome, now: number): PersistHealth {
  if (outcome.ok) {
    if (outcome.receipt.landing === WriteLanding.Landed) {
      return { kind: PersistHealthKind.Proven, at: now };
    }
    // Skipped/Coalesced: another write is already in flight and will produce its
    // own receipt — this attempt observed nothing, so health is left unchanged.
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

/**
 * What one ProseMirror transaction tells the regime, narrowed to exactly the two
 * facts the transition rule needs — not a raw `Transaction`, so this stays testable
 * without a ProseMirror/y-prosemirror runtime. `isChangeOrigin` is y-prosemirror's own
 * convention for "this transaction was synthesized from a remote Y update", read via
 * `tr.getMeta(ySyncPluginKey)?.isChangeOrigin` at the call site (`Editor.svelte`).
 */
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
