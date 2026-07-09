// Tracks how far an open on-screen keyboard has pushed the visual viewport's
// bottom edge above the layout viewport's — the gap plain CSS
// `position: fixed; bottom: …` can't see, since a fixed element is computed
// against the layout viewport while the keyboard only shrinks the visual
// one. App.svelte's `.mobile-dock` and Editor.svelte's `.fixed-toolbar`
// share this single value (see their `--kb-inset` custom property) so
// whichever one is showing rises to sit right above the keyboard instead of
// being pushed off-screen or hidden behind it.
//
// Module-level singleton: one page, one keyboard. Runs unconditionally
// rather than branching on viewport width — the consuming elements are
// display:none on desktop (see editor.css/app.css's pointer:coarse-or-narrow
// gate), so the value is simply unused there.

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

/** Reactive px gap a fixed-bottom element must rise to clear an open
 *  keyboard. 0 without `visualViewport` support — older browsers keep
 *  today's static `env(safe-area-inset-bottom)` positioning. */
export const keyboardInset = {
  get px(): number {
    return inset;
  },
};

/** Drop the inset to 0 immediately, without waiting on a `visualViewport`
 *  event. On dismiss, some mobile browsers don't fire `resize` until the
 *  keyboard's own close animation has *finished* — so a value driven purely
 *  by that event sits frozen at the open-keyboard height for the whole
 *  animation, then snaps to 0 the instant it fires. Editor.svelte calls this
 *  on `focusout` (the moment we know the keyboard is going away) so the CSS
 *  `bottom` transition can start sliding the bar down right away instead of
 *  waiting on the browser; if the keyboard was actually still open (e.g.
 *  focus moved to another field), the next `resize`/`scroll` event corrects
 *  the value again. */
export function collapseKeyboardInset(): void {
  inset = 0;
}
