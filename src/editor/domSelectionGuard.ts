/**
 * Silences a specific, benign `IndexSizeError` DOM exception that
 * prosemirror-view's own internal, asynchronous selection-resync can throw.
 *
 * Background: `EditorView`'s native `focus` DOM-event handler schedules a
 * 20ms `setTimeout` that opportunistically re-syncs the browser's native
 * selection into the view if it looks out of date
 * (`prosemirror-view/dist/index.js`, `handlers.focus`). That resync calls
 * `Selection.collapse`/`extend`/`Range.setStart`/`setEnd` against the *live*
 * DOM. Under a burst of rapid, structural transactions — e.g. heavy
 * Control+Z/Control+Y interleaved with reopening the link popover
 * (Control+K, which re-focuses the view on dismiss) — the document can keep
 * changing between when that timer is scheduled and when it fires 20ms
 * later. `view.state.selection` is always remapped and valid for
 * `view.state.doc` at that point (verified directly: this is not a stale
 * position bug in *our* code, nor in ProseMirror's state model — every
 * `from`/`to` value in play is in-bounds), but the timer's best-effort DOM
 * comparison can still hand the DOM API an offset into a since-mutated text
 * node, and `Selection.collapse`/`Range.setEnd` throw synchronously inside
 * that timer callback — a call stack no application-level `try/catch` can
 * reach, because it isn't a descendant of any of our own `view.focus()`
 * calls (see LinkPopover/SelectionToolbar/CaretFormatHint/SlashMenu, which
 * already guard every *synchronous* `coordsAtPos` call they make the same
 * way `prosemirror-view` itself guards its own equivalent case:
 * `dist/index.js` wraps `domSel.extend()` in a `try { … } catch (_) {}` a
 * few lines above the exact call site this module targets, for the
 * identical "the DOM briefly disagrees with our own bookkeeping" reason.
 *
 * That resync is purely opportunistic: every future dispatch already
 * re-syncs the DOM selection unconditionally via `EditorView.updateState`,
 * so a failed attempt here never leaves the editor in a bad state — just a
 * transiently stale native selection that self-heals on the very next
 * keystroke. Since the throw site lives entirely inside the library's own
 * timer, the only way to stop it from surfacing as an uncaught exception is
 * to guard the DOM methods it calls directly, at the call site, the same
 * way prosemirror-view guards its own sibling call — narrowly matched to
 * this exact error signature so no other failure is ever silently
 * swallowed.
 */
const STALE_SELECTION_OFFSET_ERROR =
  /The offset \d+ is larger than the node's length/;

function isStaleSelectionOffsetError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === 'IndexSizeError' &&
    STALE_SELECTION_OFFSET_ERROR.test(error.message)
  );
}

/** Wrap a 2-arg (node, offset) DOM method so this one specific error is swallowed. */
function guardOffsetMethod<T extends { [K in keyof T]: T[K] }, M extends keyof T>(
  proto: T,
  method: M
): void {
  const original = proto[method] as unknown as (this: T, node: Node, offset: number) => void;
  if (typeof original !== 'function') return;
  (proto[method] as unknown) = function guarded(this: T, node: Node, offset: number): void {
    try {
      original.call(this, node, offset);
    } catch (error) {
      if (!isStaleSelectionOffsetError(error)) throw error;
    }
  };
}

/** Install the guard once at app startup. */
export function installDomSelectionGuard(): void {
  guardOffsetMethod(Selection.prototype, 'collapse');
  guardOffsetMethod(Selection.prototype, 'extend');
  guardOffsetMethod(Range.prototype, 'setStart');
  guardOffsetMethod(Range.prototype, 'setEnd');
}
