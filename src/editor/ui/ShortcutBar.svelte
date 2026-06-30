<script lang="ts">
  // Superhuman-style keyboard-hint strip for the editor footer. Desktop only
  // (gated by a pointer:fine media query in editor.css) — touch devices have no
  // physical keyboard, so the footer there keeps just the document meta.
  //
  // The shortcuts mirror the keymap in src/editor/plugins.ts; keep them in sync.
  import { modKeyLabel } from '../../ui/platform.js';

  // OS-aware modifier glyph: ⌘ on macOS/iOS, Ctrl on Windows/Linux.
  const mod = modKeyLabel();

  type Hint = { keys: string[]; label: string };
  const hints: Hint[] = [
    { keys: [mod, 'B'], label: 'Bold' },
    { keys: [mod, 'I'], label: 'Italic' },
    { keys: [mod, 'K'], label: 'Link' },
    { keys: ['/'], label: 'Commands' },
    { keys: [mod, 'Z'], label: 'Undo' },
  ];
</script>

<div class="shortcut-bar" aria-hidden="true">
  {#each hints as h, i (h.label)}
    {#if i > 0}<span class="sc-dot">·</span>{/if}
    <span class="sc-hint">
      {#each h.keys as k (k)}<kbd>{k}</kbd>{/each}
      <span class="sc-label">{h.label}</span>
    </span>
  {/each}
</div>

<style>
  .shortcut-bar {
    display: none; /* revealed on desktop via editor.css @media (pointer: fine) */
    align-items: center;
    gap: 0.4rem;
    color: var(--text-faint);
    font-size: var(--fs-300);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
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
