<script lang="ts">
  import type { Toasts } from './toasts.svelte.js';

  let { toasts }: { toasts: Toasts } = $props();
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
  {#each toasts.items as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
      <span class="toast-icon" aria-hidden="true">
        {#if t.kind === 'error'}✕{:else if t.kind === 'success'}✓{:else}i{/if}
      </span>
      <span class="toast-text">{t.text}</span>
      <button class="toast-close ghost" onclick={() => toasts.dismiss(t.id)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: var(--sp-4);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column-reverse;
    gap: var(--sp-2);
    z-index: var(--z-toast);
    width: min(420px, calc(100vw - 2 * var(--sp-4)));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-4);
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    font-size: var(--fs-300);
    color: var(--text);
    animation: toast-in var(--dur-mid) var(--ease);
  }
  .toast-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: var(--r-full);
    font-size: 0.7rem;
    font-weight: 700;
    color: #fff;
  }
  .toast.error .toast-icon {
    background: var(--danger);
  }
  .toast.success .toast-icon {
    background: var(--ok);
  }
  .toast.info .toast-icon {
    background: var(--accent);
  }
  .toast.error {
    border-color: var(--danger);
  }
  .toast-text {
    flex: 1;
    line-height: 1.45;
  }
  .toast-close {
    flex-shrink: 0;
    min-width: 0;
    padding: 0.2rem 0.35rem;
    font-size: 0.75rem;
    color: var(--text-faint);
    border: none;
  }
  .toast-close:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-3);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
