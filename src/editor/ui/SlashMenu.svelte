<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import {
    slashKey,
    filterItems,
    runSlashItem,
    setSlashIndex,
    type SlashItem,
  } from './slashMenu.js';

  let { view, editorState }: { view: EditorView | null; editorState: EditorState | null } =
    $props();

  const st = $derived(editorState ? slashKey.getState(editorState) : null);
  const open = $derived(!!st?.active);
  const items = $derived<SlashItem[]>(st?.active ? filterItems(st.query) : []);
  const index = $derived(items.length ? Math.min(st?.active ? st.index : 0, items.length - 1) : 0);

  // Anchor the menu just below the "/" in viewport coordinates.
  const coords = $derived.by(() => {
    if (!open || !view || !st) return null;
    try {
      const c = view.coordsAtPos(st.triggerPos);
      return { left: c.left, top: c.bottom + 6 };
    } catch {
      return null;
    }
  });
</script>

{#if open && items.length > 0 && coords}
  <div
    class="slash-menu"
    role="listbox"
    aria-label="Insert block"
    style="left:{coords.left}px; top:{coords.top}px"
  >
    {#each items as item, i (item.title)}
      <button
        type="button"
        class="slash-item"
        role="option"
        aria-selected={i === index}
        data-active={i === index}
        onmousemove={() => view && setSlashIndex(view, i)}
        onmousedown={(e) => {
          e.preventDefault();
          if (view) runSlashItem(view, item);
        }}
      >
        <span class="slash-title">{item.title}</span>
        <span class="slash-hint">{item.hint}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .slash-menu {
    position: fixed;
    z-index: var(--z-menu);
    width: 248px;
    max-height: 320px;
    overflow-y: auto;
    padding: var(--sp-1);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
    animation: slash-in var(--dur-fast) var(--ease);
  }
  .slash-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .slash-item[data-active='true'] {
    background: var(--accent-soft);
  }
  .slash-title {
    font-size: var(--fs-300);
    font-weight: 500;
    color: var(--text);
  }
  .slash-item[data-active='true'] .slash-title {
    color: var(--accent-soft-text);
  }
  .slash-hint {
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  @keyframes slash-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
