export type Milliseconds = number & { readonly _brand: 'Milliseconds' };

// Lint-gated: `Date.now()` lives only in this file; construct an EpochMs via `now()`.
export type EpochMs = number & { readonly _brand: 'EpochMs' };

export function now(): EpochMs {
  return Date.now() as EpochMs;
}
