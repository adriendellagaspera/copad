// Tracks whether the user's most recent input was pointer (mouse/touch) or
// keyboard Tab navigation, exposed as `data-input-modality` on <html>.
//
// Native :focus-visible isn't enough on its own: browsers always treat a
// focused text <input>/contenteditable as "focus-visible" even right after a
// plain mouse click, and a programmatic .focus() call made inside a keydown
// handler (e.g. Escape closing a popover, returning focus to its trigger)
// counts as keyboard-driven regardless of how that popover was opened. Gate
// the ring on our own tracked modality instead of trusting the heuristic.
//
// Tab is the only key that flips modality to 'keyboard' (matching the
// classic WICG focus-visible polyfill approach) — deliberately not Escape,
// Enter, or Space, so e.g. mouse-opening a popover and dismissing it with
// Escape doesn't retroactively make the return-to-trigger focus look
// keyboard-driven and pop a ring onto it.
export function initInputModality(): () => void {
  const root = document.documentElement;
  root.dataset.inputModality = 'keyboard'; // don't hide the ring before any input is seen

  const onPointerDown = (): void => {
    root.dataset.inputModality = 'pointer';
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') root.dataset.inputModality = 'keyboard';
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeydown, true);
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeydown, true);
  };
}
