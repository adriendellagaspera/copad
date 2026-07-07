<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import { activeBlockContext } from '../commands.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
  };

  let { view, editorState }: Props = $props();

  // Names the block the caret's *line* is in (H1/H2/H3, quote, code). Unlike
  // CaretFormatHint (marks armed for the next keystroke, which rides the
  // caret's x position), a block type is a per-line property — showing it at
  // the caret reads as if it belonged to the character under it. So this
  // floats in the left margin instead, aligned with the line's own vertical
  // center, independent of where on that line the caret happens to be.
  //
  // Positioning is deliberately measurement-free: `right` pins the label's
  // right edge a fixed gap from the text column, and CSS `transform:
  // translateY(-50%)` (not a JS-computed top - height/2) centers it on the
  // line. Reading `host.offsetWidth/offsetHeight` here would race the DOM
  // patch that shows the label — the instant it flips from hidden to
  // visible, those read back stale (zero), undercentering it by half its
  // real height. That error is invisible against H1's tall line but visibly
  // overlaps the line below for H2/H3, whose line boxes are barely taller
  // than the label itself.
  let visible = $state(false);
  let top = $state(0);
  let right = $state(0);

  const GAP = 8; // px between the text column's edge and the label
  // Below this much margin there's no safe room for any label text without
  // overlapping the text column — hide rather than risk a horizontal clip.
  const MIN_MARGIN = 100;

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
    if (textEdge - marginEdge < MIN_MARGIN) {
      visible = false;
      return;
    }
    right = window.innerWidth - (textEdge - GAP);
    top = (line.top + line.bottom) / 2;
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
  style="top: {top}px; right: {right}px;"
  role="status"
  aria-live="polite"
>
  {context?.label ?? ''}
</div>
