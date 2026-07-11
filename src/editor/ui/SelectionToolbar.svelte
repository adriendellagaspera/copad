<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import { TextSelection, type EditorState } from 'prosemirror-state';
  import Toolbar from '../../Toolbar.svelte';
  import { isInTable } from '../commands.js';
  import type { Toasts } from '../../ui/toasts.svelte.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
    toasts: Toasts;
    canImport?: boolean;
    onImport?: () => void;
  };

  let { view, editorState, toasts, canImport = false, onImport }: Props = $props();

  // Floating selection bubble — desktop only (a pointer-fine media query in
  // editor.css gates visibility; the fixed Toolbar stays on touch devices where
  // selection bubbles are unreliable). Positioned over the current selection so
  // formatting is always within reach instead of pinned to the top of the doc.
  let host = $state<HTMLDivElement | undefined>();
  let visible = $state(false);
  let top = $state(0);
  let left = $state(0);

  const GAP = 8; // px between the selection and the bubble

  // Only the desktop pointer profile gets the bubble; touch keeps the fixed bar.
  const isFinePointer = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  // True once Tab has moved focus from the editor into one of the bubble's
  // own buttons — at that point the view itself is blurred, but the bubble
  // must stay up (hiding it would yank focus off the now-invisible button).
  const focusInToolbar = (): boolean =>
    !!host && !!document.activeElement && host.contains(document.activeElement);

  // The nearest <table> ancestor of a document position, if any — used to
  // anchor the bubble to the table itself rather than the caret's own line
  // when there's no real selection (see reposition()'s table branch).
  const tableElementAt = (v: EditorView, pos: number): HTMLElement | null => {
    const dom = v.domAtPos(pos).node;
    const el = dom instanceof Element ? dom : dom.parentElement;
    return el?.closest('table') ?? null;
  };

  function reposition(): void {
    const v = view;
    const st = editorState;
    if (!v || !st || !isFinePointer()) {
      visible = false;
      return;
    }
    const { from, to, empty } = st.selection;
    // Show for a real, focused selection, or a collapsed caret inside a table
    // — the fixed toolbar's table controls (add/delete row & column…) are
    // otherwise unreachable by mouse on desktop, since the fixed bar itself is
    // hidden there (see editor.css) and a bare caret has no selection to
    // bubble over. A blurred editor (e.g. focus moved to a dialog) still
    // hides it, unless focus moved into the bubble itself.
    const inTable = isInTable(st);
    if ((!v.hasFocus() && !focusInToolbar()) || (empty && !inTable)) {
      visible = false;
      return;
    }
    const w = host?.offsetWidth ?? 0;
    const h = host?.offsetHeight ?? 0;

    // A bare caret in a table anchors to the *table's* own bounding box, not
    // the caret's line — the caret can be on any row, and a line-anchored
    // bubble that flips below a header row would land on top of row 2,
    // hiding it. Anchoring to the table's outer edge instead means the
    // bubble never overlaps a cell, and stays put while Tab/arrows move the
    // caret between cells of the same table (no per-cell jitter).
    const tableEl = empty && inTable ? tableElementAt(v, from) : null;
    if (tableEl) {
      const rect = tableEl.getBoundingClientRect();
      let nextLeft = rect.left + rect.width / 2 - w / 2;
      nextLeft = Math.max(GAP, Math.min(nextLeft, window.innerWidth - w - GAP));
      let nextTop = rect.top - h - GAP;
      if (nextTop < GAP) nextTop = rect.bottom + GAP; // flip below if no room above
      left = nextLeft;
      top = nextTop;
      visible = true;
      return;
    }

    // coordsAtPos measures against the *live DOM*, which briefly disagrees
    // with `from`/`to` while a burst of transactions (e.g. rapid undo/redo)
    // is still being flushed into the view — it can throw a DOM range error
    // (`setEnd`/`collapse` offset out of bounds) even though `from`/`to` are
    // perfectly in-bounds for the ProseMirror doc itself. LinkPopover and
    // SlashMenu already guard their own coordsAtPos calls the same way: skip
    // this reposition and let the next reactive pass (which always follows
    // within a tick once things settle) try again.
    let start, end;
    try {
      start = v.coordsAtPos(from);
      end = v.coordsAtPos(to);
    } catch {
      visible = false;
      return;
    }
    const centre = (start.left + end.left) / 2;
    let nextLeft = centre - w / 2;
    nextLeft = Math.max(GAP, Math.min(nextLeft, window.innerWidth - w - GAP));
    let nextTop = start.top - h - GAP;
    if (nextTop < GAP) nextTop = end.bottom + GAP; // flip below if no room above
    left = nextLeft;
    top = nextTop;
    visible = true;
  }

  // Recompute whenever the selection (editorState) or view changes.
  $effect(() => {
    void editorState;
    void view;
    reposition();
  });

  // Keep the bubble glued to the selection while the page or any scroller moves
  // (capture catches nested scrollers, e.g. the editor's internal scroll).
  $effect(() => {
    const onMove = () => {
      if (visible) reposition();
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  });

  // Tab normally leaves the contenteditable entirely (browser default, since
  // ProseMirror only claims Tab inside a list — see buildPlugins). While the
  // bubble is showing for a real selection, redirect that Tab into its first
  // button instead, so the toolbar is reachable from the keyboard without
  // also stealing Tab when there's nothing to tab into. Inside a table, Tab
  // already has an established meaning (move to the next cell, via
  // goToNextCell in buildPlugins) — a bare caret there must NOT be
  // hijacked into the toolbar, or Tab-to-next-cell silently breaks and
  // pressing Tab instead yanks focus onto a button.
  //
  // Shift-F10 / the Menu key are the OS-standard keyboard equivalent of a
  // right-click — the same discoverable entry point Word/Excel/Sheets use
  // to reach a cell's contextual menu — so they always focus the bubble's
  // first button when it's visible, table caret or not. This is what a
  // keyboard user reaches for once Tab is unavailable (e.g. inside a table).
  //
  // Alt-Enter is a second, app-owned entry point to the same effect — F-keys
  // are frequently remapped to hardware functions (brightness/volume) behind
  // an Fn lock on laptops, making Shift-F10 unreliable exactly for the
  // keyboard-first users it targets. Alt-Enter collides with nothing else
  // bound here (plain Enter is table-boundary-escape/list-split, Mod-Enter
  // is unused) and already reads as "give me more on the thing I'm in" —
  // Windows Explorer's Alt-Enter for a file's Properties is the same idiom.
  $effect(() => {
    const v = view;
    if (!v) return;
    const dom = v.dom;
    const onKeydown = (e: KeyboardEvent) => {
      const isContextMenuKey = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
      const isAltEnter = e.key === 'Enter' && e.altKey;
      const isTabIntoBubble = e.key === 'Tab' && !e.shiftKey;
      if (!isContextMenuKey && !isAltEnter && !isTabIntoBubble) return;
      if (!visible) return;
      if (isTabIntoBubble && v.state.selection.empty && isInTable(v.state)) return;
      const target = host?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    dom.addEventListener('keydown', onKeydown);
    return () => dom.removeEventListener('keydown', onKeydown);
  });

  const focusableEls = (): HTMLElement[] =>
    host
      ? Array.from(
          host.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        )
      : [];

  // Once focus is inside the bubble, it behaves like a closed loop: Escape
  // hands focus back to the text, and Tab/Shift-Tab wrap at the ends instead
  // of escaping into whatever follows the bubble in the page's tab order.
  $effect(() => {
    const h = host;
    if (!h) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const v = view;
        if (v) {
          // Collapse to a caret at the selection's end so the bubble's own
          // reposition() (empty selection => hide) closes it, instead of
          // leaving the range selected and the bubble stuck open.
          const { to } = v.state.selection;
          v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, to)));
          v.focus();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusableEls();
      const idx = els.indexOf(document.activeElement as HTMLElement);
      if (idx === -1) return;
      if (!e.shiftKey && idx === els.length - 1) {
        e.preventDefault();
        els[0].focus();
      } else if (e.shiftKey && idx === 0) {
        e.preventDefault();
        els[els.length - 1].focus();
      }
    };
    h.addEventListener('keydown', onKeydown);
    return () => h.removeEventListener('keydown', onKeydown);
  });
</script>

<!-- preventDefault on mousedown keeps the editor's focus + selection while a
     bubble button is pressed, so runCommand applies to the right range. -->
<div
  class="sel-toolbar"
  class:visible
  bind:this={host}
  style="top: {top}px; left: {left}px;"
  onmousedown={(e) => e.preventDefault()}
  role="presentation"
>
  <Toolbar {view} {editorState} {toasts} {canImport} {onImport} />
</div>
