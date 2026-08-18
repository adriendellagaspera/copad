<script lang="ts">
  import { FontChoice, createFontChoice } from './fontChoice.svelte.js';

  const font = createFontChoice();

  const OPTIONS: { value: FontChoice; label: string }[] = [
    { value: FontChoice.Default, label: 'Default' },
    { value: FontChoice.System, label: 'System sans' },
    { value: FontChoice.Serif, label: 'Classic serif' },
    { value: FontChoice.Mono, label: 'Monospace' },
  ];
</script>

<div class="font-select" role="radiogroup" aria-label="Font">
  {#each OPTIONS as opt (opt.value)}
    <button
      type="button"
      class="font-option"
      aria-pressed={font.choice === opt.value}
      onclick={() => font.set(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  /* Same segmented control as ThemeSelect's .theme-select. */
  .font-select {
    display: inline-flex;
    flex-wrap: wrap;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-full);
    padding: 2px;
    gap: 2px;
  }
  .font-option {
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
  .font-option:hover:not([aria-pressed='true']) {
    color: var(--text);
  }
  .font-option[aria-pressed='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
</style>
