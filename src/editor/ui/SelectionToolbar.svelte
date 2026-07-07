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

  // True once Tab has moved focus from the editor into one of the bubble's
  // own buttons — at that point the view itself is blurred, but the bubble
  // must stay up (hiding it would yank focus off the now-invisible button).
  const focusInToolbar = (): boolean =>
    !!host && !!document.activeElement && host.contains(document.activeElement);

  function reposition(): void {
    const v = view;
    const st = editorState;
    if (!v || !st || !isFinePointer()) {
      visible = false;
      return;
    }
    const { from, to, empty } = st.selection;
    // Show only for a real, focused selection — a collapsed caret or a blurred
    // editor (e.g. focus moved to a dialog) hides it, unless the focus moved
    // into the bubble itself.
    if (empty || (!v.hasFocus() && !focusInToolbar())) {
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

  // Tab normally leaves the contenteditable entirely (browser default, since
  // ProseMirror only claims Tab inside a list — see buildPlugins). While the
  // bubble is showing, redirect that Tab into its first button instead, so
  // the toolbar is reachable from the keyboard without also stealing Tab
  // when there's nothing to tab into.
  $effect(() => {
    const v = view;
    if (!v) return;
    const dom = v.dom;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || !visible) return;
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
        view?.focus();
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
  <Toolbar {view} {editorState} {toasts} />
</div>
