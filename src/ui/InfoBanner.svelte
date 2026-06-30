<script lang="ts">
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { useI18n } from '../i18n/index.svelte.js';

  let {
    autoDismissMs = 0,
    children,
  }: {
    autoDismissMs?: number;
    children: Snippet;
  } = $props();

  const i18n = useI18n();
  const t = $derived(i18n.t);

  let visible = $state(true);

  $effect(() => {
    if (autoDismissMs > 0) {
      const t = setTimeout(() => { visible = false; }, autoDismissMs);
      return () => clearTimeout(t);
    }
  });
</script>

{#if visible}
  <div class="info-banner" transition:slide={{ duration: 220 }} role="note">
    <span class="info-banner-text">{@render children()}</span>
    <button class="info-banner-close" onclick={() => { visible = false; }} aria-label={t.infobanner.dismiss}>✕</button>
  </div>
{/if}

<style>
  .info-banner {
    display: flex;
    align-items: baseline;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-3) var(--sp-2) var(--sp-4);
    font-size: var(--fs-300);
    color: var(--text-muted);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
  }

  .info-banner-text {
    flex: 1;
    line-height: 1.5;
  }

  .info-banner-close {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0.1rem 0.3rem;
    font-size: 0.7rem;
    color: var(--text-faint);
    cursor: pointer;
    border-radius: var(--r-sm);
    line-height: 1;
  }

  .info-banner-close:hover {
    color: var(--text-muted);
    background: var(--surface-3);
  }
</style>
