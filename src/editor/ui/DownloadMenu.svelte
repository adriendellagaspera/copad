<script lang="ts">
  import type * as Y from 'yjs';
  import { downloadCodecs } from '../../format/index.js';
  import { downloadBytes } from '../../format/download.js';
  import type { Codec } from '../../format/types.js';
  import type { Toasts } from '../../ui/toasts.svelte.js';

  let { doc, baseName, toasts }: { doc: Y.Doc; baseName: string; toasts: Toasts } = $props();

  let open = $state(false);
  let triggerBtn = $state<HTMLButtonElement | undefined>();

  async function download(codec: Codec): Promise<void> {
    open = false;
    try {
      const bytes = await codec.encode(doc);
      await downloadBytes(bytes, `${baseName}${codec.extensions[0]}`);
      toasts.success(`Downloaded as ${codec.label}`);
    } catch (e) {
      toasts.error(`Download failed: ${(e as Error).message}`);
    }
  }

  // Escape has no focus target of its own, so return focus to the trigger
  // (unlike the backdrop click, which already leaves focus wherever clicked).
  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        open = false;
        triggerBtn?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Roving Up/Down between formats (ARIA menu convention).
  function onMenuKeydown(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
    next.focus();
  }
</script>

<div class="download">
  <button
    bind:this={triggerBtn}
    class="ghost download-btn"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-haspopup="true"
    title="Download as…"
  >
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" /></svg>
    Download
  </button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="download-backdrop" onmousedown={() => (open = false)}></div>
    <div class="download-panel" role="menu" aria-label="Download as…" tabindex="-1" onkeydown={onMenuKeydown}>
      {#each downloadCodecs as codec (codec.id)}
        <button class="download-item" role="menuitem" onclick={() => download(codec)}>
          {codec.label}
          <span class="ext">{codec.extensions[0]}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .download {
    position: relative;
  }
  .download-btn {
    min-width: 0;
    padding: 0.2rem 0.5rem;
    gap: 0.3rem;
    color: var(--text-muted);
  }
  .download-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-menu);
  }
  .download-panel {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    z-index: calc(var(--z-menu) + 1);
    width: 200px;
    padding: var(--sp-1);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
  }
  .download-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    text-align: left;
    font-size: var(--fs-300);
    color: var(--text);
    white-space: nowrap;
  }
  .download-item:hover {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }
  .download-item .ext {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--fs-200);
  }
</style>
