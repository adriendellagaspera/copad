<script lang="ts">
  import type { Theme } from './theme.svelte.js';
  import { ResolvedTheme } from './theme.svelte.js';

  let { theme }: { theme: Theme } = $props();

  const isDark = $derived(theme.resolved === ResolvedTheme.Dark);
</script>

<button
  class="ghost icon-btn"
  type="button"
  onclick={() => theme.toggle()}
  aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
  title={isDark ? 'Light theme' : 'Dark theme'}
>
  {#if isDark}
    <!-- sun -->
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  {:else}
    <!-- moon -->
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  {/if}
</button>

<style>
  /* Matches the capsule's .cap-btn metrics exactly (see app.css) — same
     36×36 circle, same hover fill — so it reads as one more item in the
     capsule's button cluster rather than a visitor with its own rules. */
  .icon-btn {
    width: 36px;
    height: 36px;
    min-width: 0;
    padding: 0;
    border: none;
    border-radius: var(--r-full);
    background: transparent;
    color: var(--text-muted);
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--surface-3);
    color: var(--text);
  }
  svg {
    display: block;
  }
</style>
