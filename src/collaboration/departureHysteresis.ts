// See docs/contract.md §2.1, §4.

import type { Milliseconds, EpochMs } from '../time.js';

/** Must exceed `GATE_LINGER_HUB_MS`, or one extension would already clamp away. */
export const GATE_LINGER_CAP_MS = 120_000 as Milliseconds;

export function departureLingerDeadline(
  departedAt: EpochMs,
  lastTypedAt: EpochMs | null,
  lingerMs: Milliseconds,
): EpochMs {
  const base = departedAt + lingerMs;
  const extended = lastTypedAt !== null && lastTypedAt > departedAt ? lastTypedAt + lingerMs : base;
  return Math.min(extended, departedAt + GATE_LINGER_CAP_MS) as EpochMs;
}
