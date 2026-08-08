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

<!-- Table-structure controls — add/remove row & column, toggle header, delete
     table — kept as a bare fragment (no wrapping element) so each caller
     supplies its own chrome: Toolbar.svelte inserts these flat into its
     single mobile row (unchanged appearance), while SelectionToolbar.svelte
     wraps them in their own floating card, visually and conceptually
     separate from text formatting (the desktop split this component exists
     for — Notion/Docs/Word all keep table structure out of the text
     toolbar). -->
{#if view}
  <button onclick={run(commands.addRowAfter)}     title="Add row below"     aria-label="Add row below">+Row</button>
  <button onclick={run(commands.addColumnAfter)}  title="Add column right"  aria-label="Add column right">+Col</button>
  <button onclick={run(commands.deleteRow)}       title="Delete row"        aria-label="Delete row">−Row</button>
  <button onclick={run(commands.deleteColumn)}    title="Delete column"     aria-label="Delete column">−Col</button>
  <button onclick={run(commands.toggleHeaderRow)} title="Toggle header row" aria-label="Toggle header row">Hdr</button>
  <button onclick={run(commands.deleteTable)}     title="Delete table"      aria-label="Delete table">🗑</button>
{/if}
