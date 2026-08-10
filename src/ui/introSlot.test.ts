import { describe, it, expect } from 'vitest';
import { PersistRegime } from '../collaboration/persistHealth.js';
import type { DocEmpty } from '../collaboration/sessionState.svelte.js';
import { IntroSlotKind, introSlotFor, type IntroEligible } from './introSlot.js';

const eligible = (v: boolean) => v as IntroEligible;
const empty = (v: boolean) => v as DocEmpty;

describe('introSlotFor', () => {
  it('holds nothing while the room does not qualify', () => {
    expect(
      introSlotFor({ eligible: eligible(false), docEmpty: empty(true), regime: PersistRegime.Cold }),
    ).toEqual({ kind: IntroSlotKind.Empty });
  });

  it('holds the first-visit card while the page is blank and nothing has been written', () => {
    expect(
      introSlotFor({ eligible: eligible(true), docEmpty: empty(true), regime: PersistRegime.Cold }),
    ).toEqual({ kind: IntroSlotKind.FirstVisit });
  });

  it('yields to the storage card once the page has content', () => {
    expect(
      introSlotFor({ eligible: eligible(true), docEmpty: empty(false), regime: PersistRegime.Cold }),
    ).toEqual({ kind: IntroSlotKind.Storage });
  });

  it('yields to the storage card once the room has warmed', () => {
    expect(
      introSlotFor({ eligible: eligible(true), docEmpty: empty(true), regime: PersistRegime.Warm }),
    ).toEqual({ kind: IntroSlotKind.Storage });
  });
});
