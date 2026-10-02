import { describe, expect, it } from 'vitest';
import type { ViewportPx } from '../../ui/viewportInset.js';
import { caretScrollDelta } from './caretVisibility.js';

const px = (value: number): ViewportPx => value as ViewportPx;

describe('caretScrollDelta', () => {
  it('does not move a caret that already has the requested clearance', () => {
    expect(
      caretScrollDelta({
        caretBottom: px(100),
        occlusionTop: px(120),
        clearance: px(8),
      }),
    ).toBe(0);
  });

  it('returns only the overlap needed to restore clearance', () => {
    expect(
      caretScrollDelta({
        caretBottom: px(118),
        occlusionTop: px(120),
        clearance: px(8),
      }),
    ).toBe(6);
  });

  it('is zero exactly on the clearance boundary', () => {
    expect(
      caretScrollDelta({
        caretBottom: px(112),
        occlusionTop: px(120),
        clearance: px(8),
      }),
    ).toBe(0);
  });
});
