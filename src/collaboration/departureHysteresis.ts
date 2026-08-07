/** Departure hysteresis — how long the write gate stays open after a peer
 *  leaves (docs/contract.md §4, "never re-lock instantly... extended by
 *  typing... capped so the contract doesn't evaporate"). Pure, no
 *  `Date.now()` inside — timestamps arrive pre-computed, same split as
 *  `writeGate.ts` / `roomLock.ts` / `leader.ts`. `lingerMs` arrives from the
 *  caller (`gateLingerMs(transport)`) since the base window itself differs
 *  per transport (§2.1) — this module only owns the shared cap. */

import type { Milliseconds } from './types.js';

/** However much typing keeps happening, the linger never outlives this many
 *  ms past the actual departure — the contract is a grace window, not an
 *  indefinite hold. Same cap for both transports; it must exceed the larger
 *  of the two base linger windows (`GATE_LINGER_HUB_MS`) or a single
 *  extension would already clamp away on the hub. */
export const GATE_LINGER_CAP_MS = 120_000 as Milliseconds;

/** The timestamp at which the departure linger lifts. Extends while the user
 *  keeps typing (`lastTypedAt` after `departedAt`), clamped to the cap. */
export function departureLingerDeadline(
  departedAt: number,
  lastTypedAt: number | null,
  lingerMs: Milliseconds,
): number {
  const base = departedAt + lingerMs;
  const extended = lastTypedAt !== null && lastTypedAt > departedAt ? lastTypedAt + lingerMs : base;
  return Math.min(extended, departedAt + GATE_LINGER_CAP_MS);
}
