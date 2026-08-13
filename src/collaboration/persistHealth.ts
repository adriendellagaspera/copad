// See docs/contract.md §3.2–§3.4.

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

export const WRITE_FAIL_STREAK = 3;

/** Terminal on first occurrence — no streak needed. */
const LOCKING_KINDS: ReadonlySet<WriteFailureKind> = new Set([
  WriteFailureKind.Denied,
  WriteFailureKind.Missing,
  WriteFailureKind.Rejected,
]);

export type WriteOutcome =
  | { readonly ok: true; readonly receipt: WriteReceipt }
  | { readonly ok: false; readonly kind: WriteFailureKind };

export function nextPersistHealth(current: PersistHealth, outcome: WriteOutcome, now: EpochMs): PersistHealth {
  if (outcome.ok) {
    if (outcome.receipt.landing === WriteLanding.Landed) {
      return { kind: PersistHealthKind.Proven, at: now };
    }
    // Coalesced: the covering write produces its own receipt.
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

export const PersistRegime = { Cold: 'cold', Warm: 'warm' } as const;
export type PersistRegime = (typeof PersistRegime)[keyof typeof PersistRegime];

/** `isChangeOrigin` is y-prosemirror's meta key marking a transaction synthesized
 *  from a remote Y update. */
export interface LocalEditSignal {
  readonly docChanged: boolean;
  readonly isChangeOrigin: boolean;
}

export function nextRegime(current: PersistRegime, signal: LocalEditSignal): PersistRegime {
  if (current === PersistRegime.Warm) return current;
  return signal.docChanged && !signal.isChangeOrigin ? PersistRegime.Warm : current;
}

export function durabilityHolds(savedHere: boolean, health: PersistHealth, regime: PersistRegime): boolean {
  if (!savedHere) return false;
  if (health.kind !== PersistHealthKind.Broken) return true;
  return regime === PersistRegime.Warm;
}
