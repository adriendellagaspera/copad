<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import { TextSelection, type EditorState } from 'prosemirror-state';
  import Toolbar from '../../Toolbar.svelte';
  import TableToolbar from './TableToolbar.svelte';
  import { isInTable } from '../commands.js';
  import { tableElementAt, positionTablePanel, choosePanel } from './tableAnchor.js';
  import type { Toasts } from '../../ui/toasts.svelte.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
    toasts: Toasts;
    canImport?: boolean;
    onImport?: () => void;
    onExport?: () => void;
  };

  let { view, editorState, toasts, canImport = false, onImport, onExport }: Props = $props();

  // Two floating panels — desktop only (a pointer-fine media query in
  // editor.css gates visibility; the fixed Toolbar stays on touch devices
  // where selection bubbles are unreliable): the text-formatting bubble
  // (`hostText`/`Toolbar`, table-structure buttons excluded — see
  // `showTableStructure` on Toolbar.svelte) and a *separate* table-structure
  // panel (`hostTable`/`TableToolbar`) shown only while an empty caret sits
  // in a table. Kept as two visually distinct cards, not one merged row, per
  // how Notion/Docs/Word separate table-structure commands from text
  // formatting even though both are reachable from inside a cell.
  let hostText = $state<HTMLDivElement | undefined>();
  let hostTable = $state<HTMLDivElement | undefined>();
  let textVisible = $state(false);
  let tableVisible = $state(false);
  let top = $state(0);
  let left = $state(0);
  let tableTop = $state(0);
  let tableLeft = $state(0);

  const GAP = 8; // px between the selection/table and either panel

  // Only the desktop pointer profile gets the bubble; touch keeps the fixed bar.
  const isFinePointer = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  // True once Tab has moved focus from the editor into a button in either
  // panel — at that point the view itself is blurred, but the panel(s) must
  // stay up (hiding them would yank focus off the now-invisible button).
  const focusInToolbar = (): boolean =>
    !!document.activeElement &&
    ((!!hostText && hostText.contains(document.activeElement)) ||
      (!!hostTable && hostTable.contains(document.activeElement)));

  function reposition(): void {
    const v = view;
    const st = editorState;
    if (!v || !st || !isFinePointer()) {
      textVisible = false;
      tableVisible = false;
      return;
    }
    const { from, to, empty } = st.selection;
    // Show for a real, focused selection, or a collapsed caret inside a table
    // — the fixed toolbar's table controls (add/delete row & column…) are
    // otherwise unreachable by mouse on desktop, since the fixed bar itself is
    // hidden there (see editor.css) and a bare caret has no selection to
    // bubble over. A blurred editor (e.g. focus moved to a dialog) still
    // hides it, unless focus moved into a panel itself.
    const inTable = isInTable(st);
    if ((!v.hasFocus() && !focusInToolbar()) || (empty && !inTable)) {
      textVisible = false;
      tableVisible = false;
      return;
    }

    const tw = hostText?.offsetWidth ?? 0;
    const th = hostText?.offsetHeight ?? 0;

    // A bare caret in a table anchors the table-structure panel to the
    // *table's* own bounding box, not the caret's line — the caret can be on
    // any row, and a line-anchored panel that flips below a header row would
    // land on top of row 2, hiding it. Anchoring to the table's outer edge
    // instead means the panel never overlaps a cell, and stays put while
    // Tab/arrows move the caret between cells of the same table (no
    // per-cell jitter). The text-formatting bubble never shows for a bare
    // caret — table or not — matching normal (outside-table) behaviour: it
    // only ever appears for a real, non-empty selection (see below).
    const tableEl = empty && inTable ? tableElementAt(v, from) : null;
    const choice = choosePanel(empty, inTable, !!tableEl);

    if (choice === 'none') {
      textVisible = false;
      tableVisible = false;
      return;
    }

    if (choice === 'table') {
      const bw = hostTable?.offsetWidth ?? 0;
      const bh = hostTable?.offsetHeight ?? 0;
      const rect = tableEl!.getBoundingClientRect();
      const panel = positionTablePanel(
        rect,
        { width: bw, height: bh },
        { width: window.innerWidth, height: window.innerHeight },
        GAP,
      );
      tableTop = panel.top;
      tableLeft = panel.left;
      textVisible = false;
      tableVisible = true;
      return;
    }
    tableVisible = false;

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
      textVisible = false;
      return;
    }
    // If the selection itself has scrolled entirely out of the viewport
    // (its own scroller, or the window), hide the bubble instead of
    // tracking it off-screen — otherwise it drifts over unrelated chrome
    // (or beyond the viewport edge) while still reporting "visible".
    if (end.bottom < 0 || start.top > window.innerHeight) {
      textVisible = false;
      return;
    }
    const centre = (start.left + end.left) / 2;
    let nextLeft = centre - tw / 2;
    nextLeft = Math.max(GAP, Math.min(nextLeft, window.innerWidth - tw - GAP));
    let nextTop = start.top - th - GAP;
    if (nextTop < GAP) nextTop = end.bottom + GAP; // flip below if no room above
    left = nextLeft;
    top = nextTop;
    textVisible = true;
  }

  // Recompute whenever the selection (editorState) or view changes.
  $effect(() => {
    void editorState;
    void view;
    reposition();
  });

  // Keep the panels glued to the selection/table while the page or any
  // scroller moves (capture catches nested scrollers, e.g. the editor's
  // internal scroll).
  $effect(() => {
    const onMove = () => {
      if (textVisible || tableVisible) reposition();
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  });

  const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // The combined tab ring across whichever floating panel(s) are actually
  // showing — text bubble first, then the table-structure panel. Used both
  // to find the first button to focus (Shift-F10/ContextMenu) and to wrap
  // Tab/Shift-Tab across the pair once focus is inside either one (see
  // attachClosedLoop below). Gated on textVisible/tableVisible (not just
  // whether the host div exists — it always does, just display:none'd when
  // hidden): a bare caret in a table shows the table panel alone, and its
  // hidden sibling's buttons must not be offered as focus targets, or
  // Shift-F10 would try to focus an unfocusable (display:none) button.
  const focusableEls = (): HTMLElement[] => [
    ...(textVisible && hostText ? Array.from(hostText.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)) : []),
    ...(tableVisible && hostTable ? Array.from(hostTable.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)) : []),
  ];

  // Tab normally leaves the contenteditable entirely (browser default, since
  // ProseMirror only claims Tab inside a list — see buildPlugins). While a
  // panel is showing for a real selection, redirect that Tab into its first
  // button instead, so the toolbar is reachable from the keyboard without
  // also stealing Tab when there's nothing to tab into. Inside a table, Tab
  // already has an established meaning (move to the next cell, via
  // goToNextCell in buildPlugins) — a bare caret there must NOT be
  // hijacked into either panel, or Tab-to-next-cell silently breaks and
  // pressing Tab instead yanks focus onto a button.
  //
  // Shift-F10 / the Menu key are the OS-standard keyboard equivalent of a
  // right-click — the same discoverable entry point Word/Excel/Sheets use
  // to reach a cell's contextual menu — so they always focus the first
  // button across both panels when either is visible, table caret or not.
  // This is what a keyboard user reaches for once Tab is unavailable (e.g.
  // inside a table). Alt-Shift-\ is a second, app-owned entry point for the
  // same action — most Mac laptop keyboards have no dedicated Menu key and
  // remap F-keys to hardware functions (volume, brightness…) behind an Fn
  // lock, so Shift-F10 alone needs Fn+Shift+F10 there, a real irritant.
  //
  // Two letter-based alternatives were tried here before this one and both
  // turned out to already mean something else: a plain Alt-Enter was
  // captured by the OS/window manager before reaching the page (a common WM
  // binding for toggling fullscreen), and Alt-Shift-T reopens the last
  // closed browser tab on at least one real setup (confirmed live) — a
  // browser-level binding this app's keydown listener never even gets a
  // chance to see. Punctuation instead of a letter sidesteps that whole
  // class of tab/window mnemonic collisions (T for tab, W for close, N for
  // new, …), at the cost of being less mnemonic itself. Matched on `e.code`
  // ('Backslash', the physical key) rather than `e.key` for the same reason
  // as before — macOS composes many Option-modified characters at the OS
  // level depending on keyboard layout, which risks the identical silent-
  // failure shape as the two rejected attempts above. Direct per-action
  // shortcuts for the table panel's own commands (Alt-Shift-R/C/Backspace/H,
  // see buildPlugins) remain the most reliable option of all — plain
  // ProseMirror keymap bindings, never racing OS/browser chrome — for
  // anyone who wants to skip the panel entirely.
  $effect(() => {
    const v = view;
    if (!v) return;
    const dom = v.dom;
    const onKeydown = (e: KeyboardEvent) => {
      // Alt-Shift-\: uses e.code (the physical key, 'Backslash') rather
      // than e.key — macOS composes Option-modified characters into
      // accented/special characters at the OS level for many combinations,
      // the same class of failure that sank the earlier Alt-Enter and
      // Alt-Shift-T attempts (see the doc comment above). e.code reports
      // the physical key regardless of what character, if any, the OS
      // composed from it.
      const isContextMenuKey =
        e.key === 'ContextMenu' ||
        (e.key === 'F10' && e.shiftKey) ||
        (e.code === 'Backslash' && e.altKey && e.shiftKey);
      const isTabIntoBubble = e.key === 'Tab' && !e.shiftKey;
      if (!isContextMenuKey && !isTabIntoBubble) return;
      if (!textVisible && !tableVisible) return;
      if (isTabIntoBubble && v.state.selection.empty && isInTable(v.state)) return;
      const target = focusableEls()[0];
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    dom.addEventListener('keydown', onKeydown);
    return () => dom.removeEventListener('keydown', onKeydown);
  });

  // Once focus is inside either panel it behaves like one closed loop:
  // Escape hands focus back to the text (regardless of which panel it came
  // from), and Tab/Shift-Tab wrap across the *combined* button list (see
  // focusableEls) instead of escaping into whatever follows in the page's
  // tab order — or, with two independent panels, stopping dead at the end
  // of whichever one focus happens to be in.
  function attachClosedLoop(el: HTMLDivElement): () => void {
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
    el.addEventListener('keydown', onKeydown);
    return () => el.removeEventListener('keydown', onKeydown);
  }

  $effect(() => {
    const cleanups: Array<() => void> = [];
    if (hostText) cleanups.push(attachClosedLoop(hostText));
    if (hostTable) cleanups.push(attachClosedLoop(hostTable));
    return () => cleanups.forEach((c) => c());
  });
</script>

<!-- preventDefault on mousedown keeps the editor's focus + selection while a
     panel button is pressed, so runCommand applies to the right range. -->
<div
  class="sel-toolbar"
  class:visible={textVisible}
  bind:this={hostText}
  style="top: {top}px; left: {left}px;"
  onmousedown={(e) => e.preventDefault()}
  role="presentation"
>
  <Toolbar {view} {editorState} {toasts} showTableStructure={false} {canImport} {onImport} {onExport} />
</div>
<div
  class="table-toolbar"
  class:visible={tableVisible}
  bind:this={hostTable}
  style="top: {tableTop}px; left: {tableLeft}px;"
  onmousedown={(e) => e.preventDefault()}
  role="presentation"
>
  <div class="toolbar" role="toolbar" aria-label="Table structure" onpointerdown={(e) => e.preventDefault()}>
    <span class="table-toolbar-label" aria-hidden="true">▦ Table</span>
    <span class="sep" role="separator"></span>
    <TableToolbar {view} />
  </div>
</div>
