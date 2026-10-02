import { visualViewportBottomInset, type ViewportPx } from './viewportInset.js';

// WebKit can fire visualViewport events before its geometry reflects the new stable viewport.
// Read it on the next animation frame (WebKit #254861) and coalesce bursts while the keyboard moves.

let inset = $state(0);
let pendingFrame: number | undefined;

if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport;
  const measure = (): void => {
    pendingFrame = undefined;
    inset = visualViewportBottomInset({
      layoutHeight: document.documentElement.clientHeight as ViewportPx,
      visualHeight: vv.height as ViewportPx,
      visualOffsetTop: vv.offsetTop as ViewportPx,
    });
  };
  const update = (): void => {
    if (pendingFrame !== undefined) window.cancelAnimationFrame(pendingFrame);
    pendingFrame = window.requestAnimationFrame(measure);
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

/** Collapse immediately on blur instead of waiting for a possibly late visualViewport close event. */
export function collapseKeyboardInset(): void {
  if (typeof window !== 'undefined' && pendingFrame !== undefined) {
    window.cancelAnimationFrame(pendingFrame);
    pendingFrame = undefined;
  }
  inset = 0;
}
