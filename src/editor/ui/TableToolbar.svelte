<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import { runCommand, commands } from '../commands.js';

  type Props = {
    view: EditorView | null;
  };

  let { view }: Props = $props();

  const run = (cmd: (typeof commands)[keyof typeof commands]) => () => {
    if (view) runCommand(view, cmd);
  };
</script>

<!-- Bare fragment, no wrapping element: each caller (Toolbar.svelte, SelectionToolbar.svelte) supplies its own chrome. -->
{#if view}
  <button onclick={run(commands.addRowAfter)}     title="Add row below"     aria-label="Add row below">+Row</button>
  <button onclick={run(commands.addColumnAfter)}  title="Add column right"  aria-label="Add column right">+Col</button>
  <button onclick={run(commands.deleteRow)}       title="Delete row"        aria-label="Delete row">−Row</button>
  <button onclick={run(commands.deleteColumn)}    title="Delete column"     aria-label="Delete column">−Col</button>
  <button onclick={run(commands.toggleHeaderRow)} title="Toggle header row" aria-label="Toggle header row">Hdr</button>
  <button onclick={run(commands.deleteTable)}     title="Delete table"      aria-label="Delete table">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M10 11v6M14 11v6" /></svg>
  </button>
{/if}
