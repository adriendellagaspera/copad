/** Whether a browser DOM is available — false in Node/SSR/test contexts
 *  without `happy-dom`/`jsdom`. The single check every DOM-dependent codec
 *  (HTML, rich-table Markdown fallback) shares. */
export function hasDom(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.DOMParser !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

/** Throws with `message` when {@link hasDom} is false — for codecs that
 *  cannot degrade and must fail loudly instead. */
export function requireDom(message: string): void {
  if (!hasDom()) throw new Error(message);
}
