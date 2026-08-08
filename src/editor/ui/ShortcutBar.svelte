<script lang="ts">
  // Superhuman-style keyboard-hint strip for the editor footer. Desktop only
  // (gated by a pointer:fine media query in editor.css) — touch devices have no
  // physical keyboard, so the footer there keeps just the document meta.
  //
  // Contextual: swaps in the table-specific set (see shortcuts.ts's
  // tableShortcuts) while the caret is in a table, instead of appending to
  // the default list — the two sets serve unrelated moments and showing both
  // at once would need to be twice as wide for no benefit.
  //
  // Even the contextual (single-context) set can still be wider than the
  // footer's available width once the sibling word-count/outline controls
  // claim their share of the row — a single-line strip with overflow:hidden
  // silently clipped or hid whole hints in that case, which is a strictly
  // worse failure mode than the strip just being two lines tall sometimes.
  // Wraps (see .shortcut-bar below) instead of clipping, so every hint stays
  // reachable no matter how narrow the remaining space gets.
  //
  // Presentation only: the shortcut data (OS-resolved) lives in shortcuts.ts.
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
      <!-- Dot lives inside the same flex item as its hint (not a standalone
           sibling) so a wrap point can only fall between whole hints — never
           leaving a lone "·" orphaned at the start of a line. -->
      {#if i > 0}<span class="sc-dot">·</span>{/if}
      {#each s.keys as k (k)}<kbd>{k}</kbd>{/each}
      <span class="sc-label">{s.label}</span>
    </span>
  {/each}
</div>

<style>
  .shortcut-bar {
    display: none; /* revealed on desktop via editor.css @media (pointer: fine) */
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

  /* Desktop only — a physical-keyboard pointer profile. */
  @media (pointer: fine) {
    .shortcut-bar {
      display: flex;
    }
  }
</style>
