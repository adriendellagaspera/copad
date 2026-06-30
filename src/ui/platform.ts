// Platform detection for OS-aware UI (e.g. keyboard-shortcut glyphs).
//
// We want the right modifier symbol per OS: ⌘ on macOS/iOS, Ctrl elsewhere.
// `navigator.platform` is deprecated and occasionally empty, so we prefer the
// modern User-Agent Client Hints (`navigator.userAgentData.platform`, which is
// e.g. "macOS"), then fall back to `platform`, then the UA string.

/** The subset of `navigator` we read — kept narrow so the parser is testable. */
export interface PlatformNavigator {
  readonly userAgentData?: { readonly platform?: string };
  readonly platform?: string;
  readonly userAgent?: string;
}

function currentNavigator(): PlatformNavigator | undefined {
  return typeof navigator !== 'undefined' ? (navigator as PlatformNavigator) : undefined;
}

/** Whether the user is on an Apple platform (macOS / iOS / iPadOS). */
export function isMacPlatform(nav: PlatformNavigator | undefined = currentNavigator()): boolean {
  if (!nav) return false;
  const signal = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(signal);
}

/** The primary modifier label for the current OS: ⌘ on Apple, Ctrl elsewhere. */
export function modKeyLabel(mac: boolean = isMacPlatform()): string {
  return mac ? '⌘' : 'Ctrl';
}
