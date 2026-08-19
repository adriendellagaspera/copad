// A keyboard shrinks only the visual viewport; `position: fixed; bottom` uses the layout viewport and can't see it.
// Consumers read this as `--kb-inset`.

let inset = $state(0);

if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport;
  const update = (): void => {
    const gap = window.innerHeight - vv.height - vv.offsetTop;
    inset = gap > 0 ? Math.round(gap) : 0;
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
