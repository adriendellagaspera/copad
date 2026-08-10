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
    tableContextOf,
    PANEL_GAP,
    type EditorFocus,
    type PointerProfile,
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

  // Visibility (pointer: fine vs coarse) is gated in editor.css, not here.
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

  // Once Tab moves focus into a panel button, the view itself is blurred, so the panel must stay up regardless.
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
    const table = tableContextOf(inTable, !!tableEl);

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
    // coordsAtPos can throw a DOM range error while a burst of transactions is still flushing into the view.
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

  $effect(() => {
    const onMove = () => {
      if (textSurface !== 'hidden' || tableVisible) reposition();
    };
    window.addEventListener('scroll', onMove, true); // capture: catches nested scrollers too
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  });

  const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // Gated on visibility, not host existence: hidden panels stay display:none, so their buttons must not be offered as focus targets.
  const focusableEls = (): HTMLElement[] => [
    ...(bubbleVisible && hostText ? Array.from(hostText.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)) : []),
    ...(tableVisible && hostTable ? Array.from(hostTable.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)) : []),
  ];

  // Shift-F10/Menu is the OS right-click equivalent; Alt-Shift-\ is a backup for Mac laptops without a Menu key.
  $effect(() => {
    const v = view;
    if (!v) return;
    const dom = v.dom;
    const onKeydown = (e: KeyboardEvent) => {
      // e.code, not e.key: macOS composes Option-modified keys into accented characters at the OS level.
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

  function attachClosedLoop(el: HTMLDivElement): () => void {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const v = view;
        if (v) {
          // Collapse to a caret so reposition()'s empty-selection check closes the bubble.
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

<!-- preventDefault on mousedown keeps the editor's selection intact while a panel button is pressed. -->
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
<!-- Read-only: pointer-events are disabled in CSS so it never steals focus or clicks from the writing surface. -->
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
    <span class="table-toolbar-label" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 16h18M9 4v16M15 4v16" /></svg>
      Table
    </span>
    <span class="sep" role="separator"></span>
    <TableToolbar {view} />
  </div>
</div>
