<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import { TextSelection, type EditorState } from 'prosemirror-state';
  import type { MarkType } from 'prosemirror-model';
  import Toolbar from '../../Toolbar.svelte';
  import TableToolbar from './TableToolbar.svelte';
  import { activeInputMarks, isInTable } from '../commands.js';
  import { schema } from '../schema.js';
  import { slashKey } from './slashMenu.js';
  import { tableElementAt, positionTablePanel, type Rect } from './tableAnchor.js';
  import {
    chooseSurfaces,
    placeCaretPill,
    placeSelectionBubble,
    PANEL_GAP,
    type EditorFocus,
    type PointerProfile,
    type TableContext,
    type TableSurface,
    type TextSurface,
  } from './floatingSurfaces.js';
  import type { Toasts } from '../../ui/toasts.svelte.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
    toasts: Toasts;
  };

  let { view, editorState, toasts }: Props = $props();

  // Desktop only — a pointer-fine media query in editor.css gates every
  // surface below; touch keeps the fixed Toolbar, where selection bubbles are
  // unreliable. `textSurface` is the formatting state of the caret: either the
  // interactive bubble over a real selection (`.sel-toolbar`) or the read-only
  // pill naming the marks a collapsed caret has armed (`.caret-hint`), never
  // both. `.table-toolbar` is orthogonal and stays a visually distinct card,
  // per how Notion/Docs/Word separate table structure from text formatting.
  let hostText = $state<HTMLDivElement | undefined>();
  let hostPill = $state<HTMLDivElement | undefined>();
  let hostTable = $state<HTMLDivElement | undefined>();
  let textSurface = $state<TextSurface>('hidden');
  let tableSurface = $state<TableSurface>('hidden');
  let top = $state(0);
  let left = $state(0);
  let tableTop = $state(0);
  let tableLeft = $state(0);

  const bubbleVisible = $derived(textSurface === 'selection');
  const pillVisible = $derived(textSurface === 'armed-caret');
  const tableVisible = $derived(tableSurface === 'shown');

  const MARK_GLYPHS: readonly { type: MarkType; label: string; render: 'b' | 'i' | 's' | 'u' | 'code' | 'link' }[] = [
    { type: schema.marks.strong, label: 'Bold', render: 'b' },
    { type: schema.marks.em, label: 'Italic', render: 'i' },
    { type: schema.marks.strike, label: 'Strikethrough', render: 's' },
    { type: schema.marks.underline, label: 'Underline', render: 'u' },
    { type: schema.marks.code, label: 'Code', render: 'code' },
    { type: schema.marks.link, label: 'Link', render: 'link' },
  ];

  const armed = $derived.by(() => {
    if (!editorState) return [];
    const active = new Set(activeInputMarks(editorState));
    return MARK_GLYPHS.filter((m) => active.has(m.type));
  });

  const pointerProfile = (): PointerProfile =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches ? 'fine' : 'coarse';

  // Tab can move focus from the editor into a panel button, blurring the view
  // while the panel must stay up.
  const focusOf = (v: EditorView): EditorFocus => {
    if (v.hasFocus()) return 'editor';
    const el = document.activeElement;
    if (el && ((hostText?.contains(el) ?? false) || (hostTable?.contains(el) ?? false))) return 'floating-panel';
    return 'elsewhere';
  };

  function hideAll(): void {
    textSurface = 'hidden';
    tableSurface = 'hidden';
  }

  function reposition(): void {
    const v = view;
    const st = editorState;
    if (!v || !st) {
      hideAll();
      return;
    }
    const { from, to, empty } = st.selection;
    const inTable = isInTable(st);
    const tableEl = empty && inTable ? tableElementAt(v, from) : null;
    const table: TableContext = !inTable
      ? 'outside-table'
      : tableEl
        ? 'table-anchored'
        : 'table-unresolved';

    const surfaces = chooseSurfaces({
      pointer: pointerProfile(),
      focus: focusOf(v),
      selection: empty ? 'collapsed' : 'ranged',
      table,
      armed: armed.length > 0 ? 'some' : 'none',
      slashMenu: slashKey.getState(st)?.active ? 'open' : 'closed',
    });

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    let tableRect: Rect | null = null;

    if (surfaces.table === 'shown' && tableEl) {
      const size = { width: hostTable?.offsetWidth ?? 0, height: hostTable?.offsetHeight ?? 0 };
      const panel = positionTablePanel(tableEl.getBoundingClientRect(), size, viewport, PANEL_GAP);
      tableTop = panel.top;
      tableLeft = panel.left;
      tableRect = { ...panel, right: panel.left + size.width, bottom: panel.top + size.height, ...size };
    }
    tableSurface = surfaces.table;

    if (surfaces.text === 'hidden') {
      textSurface = 'hidden';
      return;
    }

    const host = surfaces.text === 'selection' ? hostText : hostPill;
    const size = { width: host?.offsetWidth ?? 0, height: host?.offsetHeight ?? 0 };
    // coordsAtPos measures against the live DOM, which briefly disagrees with
    // `from`/`to` while a burst of transactions is still being flushed into
    // the view — it throws even for positions in-bounds for the doc itself.
    let start, end;
    try {
      start = v.coordsAtPos(from);
      end = surfaces.text === 'selection' ? v.coordsAtPos(to) : start;
    } catch {
      textSurface = 'hidden';
      return;
    }

    const placed =
      surfaces.text === 'selection'
        ? placeSelectionBubble(start, end, size, viewport, PANEL_GAP)
        : placeCaretPill(start, size, viewport, PANEL_GAP, tableRect);
    if (!placed.shown) {
      textSurface = 'hidden';
      return;
    }
    top = placed.at.top;
    left = placed.at.left;
    textSurface = surfaces.text;
  }

  $effect(() => {
    void editorState;
    void view;
    void armed;
    reposition();
  });

  // Keep the surfaces glued to the selection/table while the page or any
  // scroller moves (capture catches nested scrollers, e.g. the editor's own).
  $effect(() => {
    const onMove = () => {
      if (textSurface !== 'hidden' || tableVisible) reposition();
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  });

  const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // The combined tab ring across whichever panels are actually showing — text
  // bubble first, then the table-structure panel. Gated on visibility, not on
  // whether the host div exists (it always does, just display:none'd), so a
  // hidden panel's buttons are never offered as focus targets. The armed pill
  // contributes nothing: it is read-only and pointer-events:none.
  const focusableEls = (): HTMLElement[] => [
    ...(bubbleVisible && hostText ? Array.from(hostText.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)) : []),
    ...(tableVisible && hostTable ? Array.from(hostTable.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)) : []),
  ];

  // Tab normally leaves the contenteditable entirely (ProseMirror only claims
  // it inside a list — see buildPlugins). While a panel shows for a real
  // selection, redirect that Tab into its first button, so the toolbar is
  // keyboard-reachable without stealing Tab when there is nothing to tab into.
  // Inside a table Tab already means "next cell" (goToNextCell), so a bare
  // caret there must not be hijacked.
  //
  // Shift-F10 / the Menu key are the OS-standard keyboard equivalent of a
  // right-click, so they always focus the first button across both panels when
  // either is visible. Alt-Shift-\ is a second, app-owned entry point: most Mac
  // laptops need Fn+Shift+F10 for the former. It matches `e.code`
  // ('Backslash', the physical key) rather than `e.key` because macOS composes
  // Option-modified characters at the OS level — a plain Alt-Enter and
  // Alt-Shift-T were both tried and are swallowed by the window manager and the
  // browser's reopen-closed-tab binding respectively.
  $effect(() => {
    const v = view;
    if (!v) return;
    const dom = v.dom;
    const onKeydown = (e: KeyboardEvent) => {
      const isContextMenuKey =
        e.key === 'ContextMenu' ||
        (e.key === 'F10' && e.shiftKey) ||
        (e.code === 'Backslash' && e.altKey && e.shiftKey);
      const isTabIntoBubble = e.key === 'Tab' && !e.shiftKey;
      if (!isContextMenuKey && !isTabIntoBubble) return;
      if (!bubbleVisible && !tableVisible) return;
      if (isTabIntoBubble && v.state.selection.empty && isInTable(v.state)) return;
      const target = focusableEls()[0];
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    dom.addEventListener('keydown', onKeydown);
    return () => dom.removeEventListener('keydown', onKeydown);
  });

  // Once focus is inside either panel the two behave as one closed loop:
  // Escape hands focus back to the text, and Tab/Shift-Tab wrap across the
  // combined button list rather than escaping into the page's tab order.
  function attachClosedLoop(el: HTMLDivElement): () => void {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const v = view;
        if (v) {
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
  class:visible={bubbleVisible}
  bind:this={hostText}
  style="top: {top}px; left: {left}px;"
  onmousedown={(e) => e.preventDefault()}
  role="presentation"
>
  <Toolbar {view} {editorState} {toasts} showTableStructure={false} />
</div>
<!-- Read-only sibling state of the same surface: pointer-events are disabled
     in CSS so it never steals focus or clicks from the writing surface. -->
<div
  class="caret-hint"
  class:visible={pillVisible}
  bind:this={hostPill}
  style="top: {top}px; left: {left}px;"
  role="status"
  aria-live="polite"
>
  {#each armed as m (m.label)}
    <span class="ch-glyph" title={m.label} aria-label={m.label}>
      {#if m.render === 'b'}<b>B</b>
      {:else if m.render === 'i'}<i>I</i>
      {:else if m.render === 's'}<s>S</s>
      {:else if m.render === 'u'}<u>U</u>
      {:else if m.render === 'code'}<span class="ch-code">{'</>'}</span>
      {:else}<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M15 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></svg>{/if}
    </span>
  {/each}
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
