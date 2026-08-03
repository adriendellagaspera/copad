<script lang="ts">
  import type { Toasts } from './toasts.svelte.js';
  import { ToastKind } from './toasts.svelte.js';

  let { toasts }: { toasts: Toasts } = $props();
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
  {#each toasts.items as t (t.id)}
    <div
      class="toast {t.kind}"
      role={t.kind === ToastKind.Error ? 'alert' : 'status'}
      onmouseenter={() => toasts.pause(t.id)}
      onmouseleave={() => toasts.resume(t.id)}
      onfocusin={() => toasts.pause(t.id)}
      onfocusout={() => toasts.resume(t.id)}
    >
      <span class="toast-icon" aria-hidden="true">
        {#if t.kind === ToastKind.Error}✕{:else if t.kind === ToastKind.Success}✓{:else}i{/if}
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
    left: 50%;
    transform: translateX(-50%);
    /* 60px must match the dock-reservation offset in editor.css's .content padding-bottom. */
    bottom: calc(60px + env(safe-area-inset-bottom) + var(--sp-4));
    display: flex;
    flex-direction: column-reverse;
    gap: var(--sp-2);
    z-index: var(--z-toast);
    width: min(420px, calc(100vw - 2 * var(--sp-4)));
    pointer-events: none;
  }
  /* Must mirror editor.css's dock-reservation trigger, or the two disagree about when the dock is showing. */
  @media (pointer: fine) and (min-width: 901px) {
    .toasts {
      left: auto;
      right: var(--sp-4);
      transform: none;
      bottom: var(--sp-4);
    }
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
    /* >=44px hit area (WCAG 2.5.5) around a small glyph — the button grows via
       padding, not by enlarging the ✕ itself. */
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
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
