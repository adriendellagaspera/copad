<script lang="ts">
  import type { EditorState } from 'prosemirror-state';
  import { contextualShortcuts } from './shortcuts.js';
  import { isInTable } from '../commands.js';

  type Props = { editorState: EditorState | null };
  let { editorState }: Props = $props();

  const shortcuts = $derived(contextualShortcuts(!!editorState && isInTable(editorState)));
</script>

<div class="shortcut-bar" aria-hidden="true">
  {#each shortcuts as s, i (s.label)}
    <span class="sc-hint">
      <!-- Dot shares its hint's flex item so a wrap never orphans it on a new line. -->
      {#if i > 0}<span class="sc-dot">·</span>{/if}
      {#each s.keys as k (k)}<kbd>{k}</kbd>{/each}
      <span class="sc-label">{s.label}</span>
    </span>
  {/each}
</div>

<style>
  .shortcut-bar {
    display: none; /* revealed by the pointer: fine query below */
    align-items: center;
    flex-wrap: wrap;
    gap: 0.3rem 0.6rem;
    color: var(--text-faint);
    font-size: var(--fs-300);
    min-width: 0;
  }
  .sc-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .sc-dot {
    opacity: 0.5;
  }
  .sc-label {
    color: var(--text-muted);
  }
  kbd {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    line-height: 1;
    padding: 0.15rem 0.3rem;
    min-width: 1.1em;
    text-align: center;
    color: var(--text-muted);
    background: var(--surface-3);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }

  @media (pointer: fine) {
    .shortcut-bar {
      display: flex;
    }
  }
</style>
