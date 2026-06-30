// Platform detection for OS-aware UI (e.g. keyboard-shortcut glyphs).
//
// The browser is an IO boundary: we read it once and parse it into a domain
// value, never re-inspecting `navigator` downstream. `navigator.platform` is
// deprecated and occasionally empty, so we prefer the modern User-Agent Client
// Hints (`navigator.userAgentData.platform`, e.g. "macOS"), then fall back to
// `platform`, then the UA string.

/** Operating-system family. Only the distinction the UI needs is modelled —
 *  Apple platforms use the ⌘ modifier, everything else uses Ctrl. */
export const OS = { Apple: 'apple', Other: 'other' } as const;
export type OS = (typeof OS)[keyof typeof OS];

/** A single key glyph rendered in a `<kbd>` — a modifier (⌘ / Ctrl), a letter,
 *  or punctuation. Branded so the modifier can only come from OS resolution
 *  ({@link modKey}) or the literal brander ({@link keyCap}), never a bare string
 *  slipped in by hand. */
export type KeyCap = string & { readonly _brand: 'KeyCap' };

/** The subset of `navigator` we read — kept narrow so {@link parseOS} is testable. */
export interface PlatformNavigator {
  readonly userAgentData?: { readonly platform?: string };
  readonly platform?: string;
  readonly userAgent?: string;
}

function currentNavigator(): PlatformNavigator | undefined {
  return typeof navigator !== 'undefined' ? (navigator as PlatformNavigator) : undefined;
}

/**
 * Parse the browser into an {@link OS} — the single IO-boundary read of
 * `navigator`. A parser, not a validator: it returns the domain value (defaulting
 * to {@link OS.Other} when `navigator` is absent, e.g. during SSR).
 */
export function parseOS(nav: PlatformNavigator | undefined = currentNavigator()): OS {
  if (!nav) return OS.Other;
  const signal = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(signal) ? OS.Apple : OS.Other;
}

/** Brand a literal, OS-independent key cap (a letter or punctuation) — the single
 *  cast site for static caps. */
export function keyCap(literal: string): KeyCap {
  return literal as KeyCap;
}

/** The OS-resolved primary modifier cap: ⌘ on Apple platforms, Ctrl elsewhere.
 *  The single cast site that brands a modifier glyph. */
export function modKey(os: OS = parseOS()): KeyCap {
  return (os === OS.Apple ? '⌘' : 'Ctrl') as KeyCap;
}
