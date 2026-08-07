/**
 * Cross-cutting time brands. A duration and a point in time are both numbers
 * underneath but belong to different domains — branding keeps a duration from
 * being passed where a timestamp is expected, or vice versa, at a function
 * boundary (AGENTS.md's type-system rules).
 */

/** A span of time in milliseconds — a duration, not a point in time. */
export type Milliseconds = number & { readonly _brand: 'Milliseconds' };

/** A point in time, `Date.now()`-shaped. Construct only via `now()` below —
 *  the modules that adopt this brand call `Date.now()` only here, the same
 *  single-boundary pattern as `localStorage` / `localStore<T>()` in
 *  `src/persistence/local.ts`. */
export type EpochMs = number & { readonly _brand: 'EpochMs' };

export function now(): EpochMs {
  return Date.now() as EpochMs;
}
