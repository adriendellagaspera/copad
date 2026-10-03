<script lang="ts">
  import type { DialogOpen } from './types.js';

  let {
    open,
    canImport,
    onclose,
    onNew,
    onLibrary,
    onImport,
    onJoin,
    onExport,
    onSettings,
    dark,
    onToggleTheme,
    onSearch,
  }: {
    open: DialogOpen;
    canImport: boolean;
    onclose: () => void;
    onNew: () => void;
    onLibrary: () => void;
    onImport: () => void;
    onJoin: () => void;
    onExport: () => void;
    onSettings: () => void;
    dark: boolean;
    onToggleTheme: () => void;
    onSearch: () => void;
  } = $props();

  let firstAction = $state<HTMLButtonElement | undefined>();
  let picked = false;

  function run(action: () => void): void {
    picked = true;
    onclose();
    action();
  }

  $effect(() => {
    if (!open) return;
    picked = false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => firstAction?.focus());
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onclose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey, true);
      if (!picked) opener?.focus();
    };
  });
</script>

{#if open}
  <button
    type="button"
    class="mobile-actions-backdrop"
    aria-label="Close document actions"
    onclick={onclose}
  ></button>

  <div class="mobile-actions-sheet" role="dialog" aria-modal="true" aria-label="Document actions">
    <div class="mobile-actions-grab" aria-hidden="true"></div>
    <div class="mobile-actions-list">
      <button bind:this={firstAction} type="button" class="mobile-actions-row" onclick={() => run(onNew)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span>New document</span>
      </button>
      <button type="button" class="mobile-actions-row" onclick={() => run(onLibrary)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H15a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5H20Z" /></svg>
        <span>Your documents</span>
      </button>
      <button
        type="button"
        class="mobile-actions-row"
        disabled={!canImport}
        title={canImport ? 'Import a file into this document' : 'Import is available when this document is writable'}
        onclick={() => run(onImport)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>
        <span>Import a file</span>
      </button>
      <button type="button" class="mobile-actions-row" onclick={() => run(onJoin)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
        <span>Join a meeting link</span>
      </button>
      <button type="button" class="mobile-actions-row" onclick={() => run(onExport)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0-4 4m4-4 4 4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>
        <span>Export a copy</span>
      </button>

      <div class="mobile-actions-divider" aria-hidden="true"></div>

      <button type="button" class="mobile-actions-row" onclick={() => run(onSettings)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
        <span>Settings</span>
      </button>
      <button type="button" class="mobile-actions-row" onclick={() => run(onToggleTheme)}>
        {#if dark}
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          <span>Light appearance</span>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
          <span>Dark appearance</span>
        {/if}
      </button>

      <div class="mobile-actions-divider" aria-hidden="true"></div>

      <button type="button" class="mobile-actions-row mobile-actions-search" onclick={() => run(onSearch)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
        <span>Search document &amp; commands</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .mobile-actions-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    width: 100%;
    min-height: 100%;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--overlay);
  }

  .mobile-actions-sheet {
    position: fixed;
    z-index: calc(var(--z-dialog) + 1);
    left: 50%;
    bottom: calc(8px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(420px, calc(100vw - 16px));
    padding: 8px;
    border-radius: 18px;
    background: var(--surface);
    box-shadow: var(--shadow-lg);
  }

  .mobile-actions-grab {
    width: 32px;
    height: 4px;
    margin: 2px auto 8px;
    border-radius: var(--r-full);
    background: var(--border-strong);
  }

  .mobile-actions-list {
    display: flex;
    flex-direction: column;
  }

  .mobile-actions-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--mobile-control-gap);
    width: 100%;
    min-height: var(--mobile-action-row);
    padding: 0 var(--mobile-inline-pad);
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-400);
    text-align: left;
  }

  .mobile-actions-row:hover:not(:disabled),
  .mobile-actions-row:active:not(:disabled) {
    background: var(--surface-3);
  }

  .mobile-actions-row:disabled {
    opacity: 0.42;
  }

  .mobile-actions-row svg {
    width: var(--mobile-icon);
    height: var(--mobile-icon);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--text-muted);
  }

  .mobile-actions-divider {
    height: 1px;
    margin: 6px 14px;
    background: var(--border);
  }

  .mobile-actions-search {
    color: var(--text-muted);
  }
</style>
