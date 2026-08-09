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
  };

  let { view, editorState, toasts }: Props = $props();

  // Visibility (pointer: fine vs coarse) is gated in editor.css, not here.
  let hostText = $state<HTMLDivElement | undefined>();
  let hostTable = $state<HTMLDivElement | undefined>();
  let textVisible = $state(false);
  let tableVisible = $state(false);
  let top = $state(0);
  let left = $state(0);
  let tableTop = $state(0);
  let tableLeft = $state(0);

  const GAP_PX = 8;

  const isFinePointer = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  // Once Tab moves focus into a panel button, the view itself is blurred, so the panel must stay up regardless.
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
    const inTable = isInTable(st);
    if ((!v.hasFocus() && !focusInToolbar()) || (empty && !inTable)) {
      textVisible = false;
      tableVisible = false;
      return;
    }

    const tw = hostText?.offsetWidth ?? 0;
    const th = hostText?.offsetHeight ?? 0;

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
        GAP_PX,
      );
      tableTop = panel.top;
      tableLeft = panel.left;
      textVisible = false;
      tableVisible = true;
      return;
    }
    tableVisible = false;

    // coordsAtPos can throw a DOM range error while a burst of transactions is still flushing into the view.
    let start, end;
    try {
      start = v.coordsAtPos(from);
      end = v.coordsAtPos(to);
    } catch {
      textVisible = false;
      return;
    }
    if (end.bottom < 0 || start.top > window.innerHeight) {
      textVisible = false;
      return;
    }
    const centre = (start.left + end.left) / 2;
    let nextLeft = centre - tw / 2;
    nextLeft = Math.max(GAP_PX, Math.min(nextLeft, window.innerWidth - tw - GAP_PX));
    let nextTop = start.top - th - GAP_PX;
    if (nextTop < GAP_PX) nextTop = end.bottom + GAP_PX;
    left = nextLeft;
    top = nextTop;
    textVisible = true;
  }

  $effect(() => {
    void editorState;
    void view;
    reposition();
  });

  $effect(() => {
    const onMove = () => {
      if (textVisible || tableVisible) reposition();
    };
    window.addEventListener('scroll', onMove, true); // capture: catches nested scrollers too
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  });

  const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // Gated on textVisible/tableVisible, not host existence: hidden panels stay display:none, so their buttons must not be offered as focus targets.
  const focusableEls = (): HTMLElement[] => [
    ...(textVisible && hostText ? Array.from(hostText.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)) : []),
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
  class:visible={textVisible}
  bind:this={hostText}
  style="top: {top}px; left: {left}px;"
  onmousedown={(e) => e.preventDefault()}
  role="presentation"
>
  <Toolbar {view} {editorState} {toasts} showTableStructure={false} />
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
