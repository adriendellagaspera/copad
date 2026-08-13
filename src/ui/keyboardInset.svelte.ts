// A keyboard shrinks the visual viewport only, so `position: fixed; bottom` — computed against the layout viewport — can't see it; consumers read this as `--kb-inset`.

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

/** Some mobile browsers fire `resize` only once the keyboard's close animation ends; a later event corrects an early zero. */
export function collapseKeyboardInset(): void {
  inset = 0;
}
