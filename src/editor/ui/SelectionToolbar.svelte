<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import Toolbar from '../../Toolbar.svelte';
  import type { Toasts } from '../../ui/toasts.svelte.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
    toasts: Toasts;
  };

  let { view, editorState, toasts }: Props = $props();

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

  function reposition(): void {
    const v = view;
    const st = editorState;
    if (!v || !st || !isFinePointer()) {
      visible = false;
      return;
    }
    const { from, to, empty } = st.selection;
    // Show only for a real, focused selection — a collapsed caret or a blurred
    // editor (e.g. focus moved to a dialog) hides it.
    if (empty || !v.hasFocus()) {
      visible = false;
      return;
    }
    const start = v.coordsAtPos(from);
    const end = v.coordsAtPos(to);
    const w = host?.offsetWidth ?? 0;
    const h = host?.offsetHeight ?? 0;
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
  <Toolbar {view} {editorState} {toasts} />
</div>
