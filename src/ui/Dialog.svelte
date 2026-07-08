<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open,
    onclose,
    title,
    size = 'sm',
    flush = false,
    children,
  }: {
    open: boolean;
    onclose: () => void;
    title: string;
    size?: 'sm' | 'lg';
    flush?: boolean;
    children: Snippet;
  } = $props();

  let dialogEl = $state<HTMLDivElement | undefined>();
  let titleId = 'dialog-title';

  function trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !dialogEl) return;
    const f = dialogEl.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    queueMicrotask(() => {
      const el = dialogEl?.querySelector<HTMLElement>(
        '[autofocus], input, button:not(.dialog-close), a[href]'
      );
      (el ?? dialogEl)?.focus();
    });
    return () => {
      document.body.style.overflow = '';
      restoreTo?.focus?.();
    };
  });

  // Window-level Escape, not just the dialog div's onkeydown above, because focus
  // can end up outside the dialog (e.g. a native <details>/<summary> toggle or a
  // click on non-interactive text) — Escape must still close it either way. Capture
  // phase so we see it before any other in-page listener (or a browser-extension
  // content script on an autofocused input, e.g. a password manager) gets a chance
  // to stopPropagation() or otherwise swallow the first press.
  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onclose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog-backdrop" onclick={onclose}>
    <div
      class="dialog"
      class:dialog-lg={size === 'lg'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      bind:this={dialogEl}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={trapTab}
    >
      <div class="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button class="ghost dialog-close" onclick={onclose} aria-label="Close dialog">✕</button>
      </div>
      <div class="dialog-body" class:dialog-body-flush={flush}>
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    display: grid;
    place-items: center;
    padding: var(--sp-4);
    z-index: var(--z-dialog);
    animation: backdrop-in var(--dur-fast) var(--ease);
  }
  .dialog {
    width: min(440px, 100%);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-lg);
    outline: none;
    animation: dialog-in var(--dur-mid) var(--ease);
  }
  .dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-4) var(--sp-4) var(--sp-2);
  }
  .dialog-head h2 {
    margin: 0;
    font-size: var(--fs-500);
    font-weight: 600;
  }
  .dialog-close {
    /* >=44px hit area (WCAG 2.5.5) around a small glyph — the button grows via
       padding, not by enlarging the ✕ itself. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    color: var(--text-muted);
    border: none;
  }
  .dialog-body {
    padding: var(--sp-2) var(--sp-4) var(--sp-4);
  }
  .dialog-body-flush {
    padding: 0;
  }
  .dialog-lg {
    width: min(860px, 92vw);
    height: min(640px, 86vh);
    display: flex;
    flex-direction: column;
  }
  .dialog-lg .dialog-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes dialog-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @media (max-width: 640px) {
    .dialog-backdrop {
      place-items: end center;
      padding: 0;
    }
    .dialog {
      width: 100%;
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      animation: sheet-in var(--dur-mid) var(--ease);
    }
    .dialog-lg {
      height: 94dvh;
    }
  }
  @keyframes sheet-in {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
</style>
