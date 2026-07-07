<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import { activeBlockContext } from '../commands.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
  };

  let { view, editorState }: Props = $props();

  // Names the block the caret's *line* is in (H1/H2/H3, list, quote, code).
  // Unlike CaretFormatHint (marks armed for the next keystroke, which rides
  // the caret's x position), a block type is a per-line property — showing
  // it at the caret reads as if it belonged to the character under it. So
  // this floats in the left margin instead, aligned with the line's own top,
  // independent of where on that line the caret happens to be.
  let host = $state<HTMLDivElement | undefined>();
  let visible = $state(false);
  let top = $state(0);
  let left = $state(0);

  const GAP = 8; // px between the text column's edge and the label

  const isFinePointer = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  const context = $derived.by(() => (editorState ? activeBlockContext(editorState) : null));

  function reposition(): void {
    const v = view;
    const ctx = context;
    if (!v || !ctx || !isFinePointer() || !v.hasFocus()) {
      visible = false;
      return;
    }
    const line = v.coordsAtPos(ctx.pos);
    // The margin only exists once the centered text column (.ProseMirror,
    // max-width: var(--measure)) has room to breathe inside its scroller
    // (.content). Below that width the column fills the scroller and there's
    // nowhere to put the label without overlapping text — hide rather than
    // fake it, the caret hint still covers marks on narrow viewports.
    const textEdge = v.dom.getBoundingClientRect().left;
    const marginEdge = v.dom.parentElement?.getBoundingClientRect().left ?? 0;
    const w = host?.offsetWidth ?? 0;
    const h = host?.offsetHeight ?? 0;
    const nextLeft = textEdge - GAP - w;
    if (nextLeft < marginEdge) {
      visible = false;
      return;
    }
    left = nextLeft;
    top = (line.top + line.bottom) / 2 - h / 2;
    visible = true;
  }

  // Recompute whenever the selection (editorState) or view changes — cheap,
  // and the anchor (line start) doesn't move on every keystroke the way a
  // caret-following x position would, so there's no jitter to guard against.
  $effect(() => {
    void editorState;
    void view;
    void context;
    reposition();
  });

  // Keep the label glued to its line while the page or any scroller moves
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
</script>

<!-- Purely informational: pointer-events are disabled in CSS so it never
     steals focus or clicks from the writing surface. -->
<div
  class="line-hint"
  class:visible
  bind:this={host}
  style="top: {top}px; left: {left}px;"
  role="status"
  aria-live="polite"
>
  {context?.label ?? ''}
</div>
