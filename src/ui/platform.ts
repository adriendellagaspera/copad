// `navigator.platform` is deprecated and sometimes empty, hence the Client Hints signal first.

export const OS = { Apple: 'apple', Other: 'other' } as const;
export type OS = (typeof OS)[keyof typeof OS];

export type KeyCap = string & { readonly _brand: 'KeyCap' };

export interface PlatformNavigator {
  readonly userAgentData?: { readonly platform?: string };
  readonly platform?: string;
  readonly userAgent?: string;
}

function currentNavigator(): PlatformNavigator | undefined {
  return typeof navigator !== 'undefined' ? (navigator as PlatformNavigator) : undefined;
}

export function parseOS(nav: PlatformNavigator | undefined = currentNavigator()): OS {
  if (!nav) return OS.Other;
  const signal = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(signal) ? OS.Apple : OS.Other;
}

export function keyCap(literal: string): KeyCap {
  return literal as KeyCap;
}

export function modKey(os: OS = parseOS()): KeyCap {
  return (os === OS.Apple ? '⌘' : 'Ctrl') as KeyCap;
}

/** Display only: `KeyboardEvent.key` still reports `'Alt'` on Apple. */
export function altKey(os: OS = parseOS()): KeyCap {
  return (os === OS.Apple ? '⌥' : 'Alt') as KeyCap;
}
