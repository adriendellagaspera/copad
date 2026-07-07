<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import type { MarkType } from 'prosemirror-model';
  import { activeInputMarks, activeBlockLabel } from '../commands.js';
  import { schema } from '../schema.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
  };

  let { view, editorState }: Props = $props();

  // "Armed formatting" hint — desktop only. With the fixed toolbar hidden on
  // desktop (the SelectionToolbar bubble takes over) and that bubble only
  // showing for a real selection, nothing told the writer that Mod-B/Mod-I had
  // armed a mark *before* they typed. This is a small, non-interactive pill
  // that floats over the collapsed caret and names the marks the next keystroke
  // will carry, plus the block context (H1/H2/H3, list, quote, code) so a
  // writer can tell they're in a Heading 2 rather than a Heading 3 without
  // opening the toolbar. On touch the fixed toolbar's pressed buttons already
  // show it, so this stays out of the way (pointer-fine gates it in editor.css).
  let host = $state<HTMLDivElement | undefined>();
  let visible = $state(false);
  let top = $state(0);
  let left = $state(0);

  const GAP = 8; // px between the caret and the pill

  // Presentation order + glyph for each mark the schema can carry, so the pill
  // reads like the toolbar the writer already knows.
  const MARK_GLYPHS: readonly { type: MarkType; label: string; render: 'b' | 'i' | 's' | 'code' | 'link' }[] = [
    { type: schema.marks.strong, label: 'Bold', render: 'b' },
    { type: schema.marks.em, label: 'Italic', render: 'i' },
    { type: schema.marks.strike, label: 'Strikethrough', render: 's' },
    { type: schema.marks.code, label: 'Code', render: 'code' },
    { type: schema.marks.link, label: 'Link', render: 'link' },
  ];

  const isFinePointer = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  // The armed marks, in toolbar order, restricted to the ones we render.
  const armed = $derived.by(() => {
    if (!editorState) return [];
    const active = new Set(activeInputMarks(editorState));
    return MARK_GLYPHS.filter((m) => active.has(m.type));
  });

  // The block the caret sits in (heading level, list, quote, code) — null for
  // a plain paragraph so the hint doesn't fire on every keystroke.
  const blockLabel = $derived.by(() => (editorState ? activeBlockLabel(editorState) : null));

  function reposition(): void {
    const v = view;
    const st = editorState;
    if (
      !v ||
      !st ||
      !isFinePointer() ||
      (armed.length === 0 && !blockLabel) ||
      !v.hasFocus()
    ) {
      visible = false;
      return;
    }
    const { from, empty } = st.selection;
    // A real selection is the SelectionToolbar's job; the hint is caret-only.
    if (!empty) {
      visible = false;
      return;
    }
    const caret = v.coordsAtPos(from);
    const w = host?.offsetWidth ?? 0;
    const h = host?.offsetHeight ?? 0;
    let nextLeft = caret.left - w / 2;
    nextLeft = Math.max(GAP, Math.min(nextLeft, window.innerWidth - w - GAP));
    let nextTop = caret.top - h - GAP;
    if (nextTop < GAP) nextTop = caret.bottom + GAP; // flip below if no room above
    left = nextLeft;
    top = nextTop;
    visible = true;
  }

  // Recompute whenever the selection (editorState), view, or armed set changes.
  $effect(() => {
    void editorState;
    void view;
    void armed;
    void blockLabel;
    reposition();
  });

  // Keep the pill glued to the caret while the page or any scroller moves
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

<!-- Purely informational: pointer-events are disabled in CSS so it never steals
     focus or clicks from the writing surface. -->
<div
  class="caret-hint"
  class:visible
  bind:this={host}
  style="top: {top}px; left: {left}px;"
  role="status"
  aria-live="polite"
>
  {#if blockLabel}
    <span class="ch-block">{blockLabel}</span>
  {/if}
  {#each armed as m (m.label)}
    <span class="ch-glyph" title={m.label} aria-label={m.label}>
      {#if m.render === 'b'}<b>B</b>
      {:else if m.render === 'i'}<i>I</i>
      {:else if m.render === 's'}<s>S</s>
      {:else if m.render === 'code'}<span class="ch-code">{'</>'}</span>
      {:else}<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M15 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></svg>{/if}
    </span>
  {/each}
</div>
