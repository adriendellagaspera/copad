// Replaces :focus-visible: browsers force it true for a mouse-clicked text field and a keydown-triggered .focus().
// Tab alone flips to 'keyboard': Escape/Enter/Space would ring a pointer-opened popover's trigger on dismissal.
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
