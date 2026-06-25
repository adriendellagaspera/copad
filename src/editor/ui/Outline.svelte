<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import { TextSelection } from 'prosemirror-state';

  let { view, editorState }: { view: EditorView | null; editorState: EditorState | null } =
    $props();

  interface Heading {
    level: number;
    text: string;
    pos: number;
  }

  const headings = $derived.by<Heading[]>(() => {
    if (!editorState) return [];
    const list: Heading[] = [];
    editorState.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        list.push({ level: node.attrs.level as number, text: node.textContent || 'Untitled', pos });
      }
    });
    return list;
  });

  let open = $state(false);

  function goto(pos: number): void {
    if (!view) return;
    const target = Math.min(pos + 1, view.state.doc.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)).scrollIntoView());
    view.focus();
    open = false;
  }
</script>

{#if headings.length > 0}
  <div class="outline">
    <button
      class="ghost outline-btn"
      onclick={() => (open = !open)}
      aria-expanded={open}
      title="Document outline"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
      Contents
    </button>
    {#if open}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="outline-backdrop" onmousedown={() => (open = false)}></div>
      <div class="outline-panel" role="menu" aria-label="Document outline">
        {#each headings as h (h.pos)}
          <button
            class="outline-item"
            role="menuitem"
            style="padding-left:{(h.level - 1) * 12 + 10}px"
            onclick={() => goto(h.pos)}
          >
            {h.text}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .outline {
    position: relative;
  }
  .outline-btn {
    min-width: 0;
    padding: 0.2rem 0.5rem;
    gap: 0.3rem;
    color: var(--text-muted);
  }
  .outline-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-menu);
  }
  .outline-panel {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    z-index: calc(var(--z-menu) + 1);
    width: 240px;
    max-height: 320px;
    overflow-y: auto;
    padding: var(--sp-1);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
  }
  .outline-item {
    display: block;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    text-align: left;
    font-size: var(--fs-300);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .outline-item:hover {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }
</style>
