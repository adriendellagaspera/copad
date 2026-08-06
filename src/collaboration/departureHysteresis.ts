/** Departure hysteresis — how long the write gate stays open after a peer
 *  leaves (docs/contract.md §4, "never re-lock instantly... extended by
 *  typing... capped so the contract doesn't evaporate"). Pure, no
 *  `Date.now()` inside — timestamps arrive pre-computed, same split as
 *  `writeGate.ts` / `roomLock.ts` / `leader.ts`. */

import { GATE_LINGER_MS } from './writeGate.js';

/** However much typing keeps happening, the linger never outlives this many
 *  ms past the actual departure — the contract is a grace window, not an
 *  indefinite hold. */
export const GATE_LINGER_CAP_MS = 30_000;

/** The timestamp at which the departure linger lifts. Extends while the user
 *  keeps typing (`lastTypedAt` after `departedAt`), clamped to the cap. */
export function departureLingerDeadline(departedAt: number, lastTypedAt: number | null): number {
  const base = departedAt + GATE_LINGER_MS;
  const extended = lastTypedAt !== null && lastTypedAt > departedAt ? lastTypedAt + GATE_LINGER_MS : base;
  return Math.min(extended, departedAt + GATE_LINGER_CAP_MS);
}
