import { visualViewportBottomInset, type ViewportPx } from './viewportInset.js';

// WebKit can make innerHeight follow visualViewport under the keyboard; clientHeight remains the layout viewport.

let inset = $state(0);

if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport;
  const update = (): void => {
    inset = visualViewportBottomInset({
      layoutHeight: document.documentElement.clientHeight as ViewportPx,
      visualHeight: vv.height as ViewportPx,
      visualOffsetTop: vv.offsetTop as ViewportPx,
    });
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

export const keyboardInset = {
  get px(): number {
    return inset;
  },
};

/** Some mobile browsers fire `resize` only after the keyboard's close animation ends, fixing an early zero. */
export function collapseKeyboardInset(): void {
  inset = 0;
}
