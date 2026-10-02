import { describe, expect, it } from 'vitest';
import { visualViewportBottomInset, type ViewportPx } from './viewportInset.js';

describe('visualViewportBottomInset', () => {
  it('is zero when the visual viewport fills the layout viewport', () => {
    expect(
      visualViewportBottomInset({
        layoutHeight: 664 as ViewportPx,
        visualHeight: 664 as ViewportPx,
        visualOffsetTop: 0 as ViewportPx,
      }),
    ).toBe(0);
  });

  it('measures the hidden layout-viewport bottom after keyboard shrink and pan', () => {
    expect(
      visualViewportBottomInset({
        layoutHeight: 664 as ViewportPx,
        visualHeight: 364 as ViewportPx,
        visualOffsetTop: 96 as ViewportPx,
      }),
    ).toBe(204);
    expect(
      visualViewportBottomInset({
        layoutHeight: 664 as ViewportPx,
        visualHeight: 364 as ViewportPx,
        visualOffsetTop: 124 as ViewportPx,
      }),
    ).toBe(176);
  });

  it('clamps a visual viewport extending beyond the layout bottom', () => {
    expect(
      visualViewportBottomInset({
        layoutHeight: 664 as ViewportPx,
        visualHeight: 650 as ViewportPx,
        visualOffsetTop: 20 as ViewportPx,
      }),
    ).toBe(0);
  });
});
