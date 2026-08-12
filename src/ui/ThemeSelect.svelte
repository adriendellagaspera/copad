<script lang="ts">
  import type { Theme } from './theme.svelte.js';
  import { ThemeChoice } from './theme.svelte.js';

  let { theme }: { theme: Theme } = $props();

  const OPTIONS: { value: ThemeChoice; label: string }[] = [
    { value: ThemeChoice.Light, label: 'Light' },
    { value: ThemeChoice.Dark, label: 'Dark' },
    { value: ThemeChoice.System, label: 'System' },
  ];
</script>

<div class="theme-select" role="radiogroup" aria-label="Appearance">
  {#each OPTIONS as opt (opt.value)}
    <button
      type="button"
      class="theme-option"
      aria-pressed={theme.choice === opt.value}
      onclick={() => theme.set(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  /* Same segmented control as .settings-nav-item (Settings.svelte). */
  .theme-select {
    display: inline-flex;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-full);
    padding: 2px;
    gap: 2px;
  }
  .theme-option {
    border: none;
    background: transparent;
    padding: 0.4rem 1rem;
    border-radius: var(--r-full);
    font: inherit;
    font-size: var(--fs-300);
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
  }
  .theme-option:hover:not([aria-pressed='true']) {
    color: var(--text);
  }
  .theme-option[aria-pressed='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
</style>
