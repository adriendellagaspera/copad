import { PersistRegime } from '../collaboration/persistHealth.js';
import type { DocEmpty } from '../collaboration/sessionState.svelte.js';

export type IntroEligible = boolean & { readonly _brand: 'IntroEligible' };

export const IntroSlotKind = {
  Empty: 'empty',
  FirstVisit: 'first-visit',
  Storage: 'storage',
} as const;
export type IntroSlotKind = (typeof IntroSlotKind)[keyof typeof IntroSlotKind];

export type IntroSlot =
  | { readonly kind: typeof IntroSlotKind.Empty }
  | { readonly kind: typeof IntroSlotKind.FirstVisit }
  | { readonly kind: typeof IntroSlotKind.Storage };

export interface IntroSlotInput {
  readonly eligible: IntroEligible;
  readonly docEmpty: DocEmpty;
  readonly regime: PersistRegime;
}

export function introSlotFor(input: IntroSlotInput): IntroSlot {
  if (!input.eligible) return { kind: IntroSlotKind.Empty };
  return input.docEmpty && input.regime === PersistRegime.Cold
    ? { kind: IntroSlotKind.FirstVisit }
    : { kind: IntroSlotKind.Storage };
}
