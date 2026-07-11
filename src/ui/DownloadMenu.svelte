<script lang="ts">
  import { downloadCodecs } from '../format/index.js';
  import { downloadBytes } from '../format/download.js';
  import { downloadBridge } from '../editor/downloadBridge.svelte.js';
  import type { Codec } from '../format/types.js';
  import type { Toasts } from './toasts.svelte.js';

  // Lives in the header capsule (desktop) and the mobile dock — same
  // "always-reachable app chrome" tier as Share/Settings, not buried in the
  // editor's own status bar (hidden on mobile, and a long mouse trip on
  // desktop). Popover shell mirrors IdentityMenu.svelte: a viewport-clamped
  // popover on desktop, a pinned bottom sheet on mobile — same condition
  // app.css's .mobile-dock uses to switch chrome.

  let { baseName, toasts }: { baseName: string; toasts: Toasts } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | undefined>();
  let triggerBtn = $state<HTMLButtonElement | undefined>();
  let panelEl = $state<HTMLDivElement | undefined>();

  let flipAbove = $state(false);
  let shiftX = $state(0);
  let compact = $state(false);

  function isCompact(): boolean {
    return window.matchMedia('(pointer: coarse), (max-width: 900px)').matches;
  }

  // Same viewport-aware placement as IdentityMenu.svelte: measure the panel
  // once in its default (below, unshifted) position and correct only the
  // axes that actually overflow. No-op on the compact breakpoint, where CSS
  // pins the panel to the bottom of the screen instead.
  function positionPopover(): void {
    flipAbove = false;
    shiftX = 0;
    if (isCompact() || !panelEl) return;
    const margin = 8;
    const rect = panelEl.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - margin) flipAbove = true;
    let dx = 0;
    if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
    if (rect.left + dx < margin) dx = margin - rect.left;
    shiftX = dx;
  }

  function closeAndReturnFocus(): void {
    open = false;
    triggerBtn?.focus();
  }

  async function download(codec: Codec): Promise<void> {
    closeAndReturnFocus();
    try {
      const bytes = await downloadBridge.request(codec);
      await downloadBytes(bytes, `${baseName}${codec.extensions[0]}`);
      toasts.success(`Downloaded as ${codec.label}`);
    } catch (e) {
      toasts.error(`Download failed: ${(e as Error).message}`);
    }
  }

  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse), (max-width: 900px)');
    compact = mql.matches;
    const onChange = (e: MediaQueryListEvent) => { compact = e.matches; };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  // Same tab-trap shape as Dialog.svelte/IdentityMenu.svelte, scoped to the
  // panel. Only wired up while `compact` — the desktop popover has no
  // backdrop and was never meant to behave modally.
  function trapTab(e: KeyboardEvent): void {
    if (!compact || e.key !== 'Tab' || !panelEl) return;
    const f = panelEl.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (f.length === 0) return;
    const first = f[0]!;
    const last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Roving Up/Down between formats (ARIA menu convention).
  function onMenuKeydown(e: KeyboardEvent): void {
    trapTab(e);
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
    next?.focus();
  }

  $effect(() => {
    if (!open) return;
    positionPopover();
    if (compact) document.body.style.overflow = 'hidden';
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndReturnFocus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', positionPopover);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', positionPopover);
    };
  });
</script>

<div class="download" bind:this={root}>
  <button
    bind:this={triggerBtn}
    class="download-btn"
    aria-haspopup="true"
    aria-expanded={open}
    title="Download as…"
    aria-label="Download document"
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" /></svg>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="download-backdrop" onclick={closeAndReturnFocus} aria-hidden="true"></div>
    <div
      class="download-pop"
      class:above={flipAbove}
      style="--shift-x: {shiftX}px"
      bind:this={panelEl}
      role="menu"
      aria-label="Download as…"
      tabindex="-1"
      onkeydown={onMenuKeydown}
    >
      <div class="download-sheet-grab" aria-hidden="true"></div>
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
    display: inline-flex;
  }
  .download-btn {
    width: 36px;
    height: 36px;
    flex: none;
    padding: 0;
    border: none;
    border-radius: var(--r-full);
    background: transparent;
    color: var(--text-muted);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  }
  .download-btn:hover:not(:disabled) {
    background: var(--surface-3);
    color: var(--text);
  }

  .download-backdrop {
    display: none;
  }

  .download-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--z-menu);
    width: 220px;
    max-width: calc(100vw - 16px);
    padding: var(--sp-1);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
    transform: translateX(var(--shift-x, 0px));
    animation: download-in var(--dur-fast) var(--ease);
  }
  .download-pop.above {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .download-sheet-grab {
    display: none;
  }
  @keyframes download-in {
    from { opacity: 0; transform: translateY(-4px) translateX(var(--shift-x, 0px)); }
    to { opacity: 1; transform: translateY(0) translateX(var(--shift-x, 0px)); }
  }

  .download-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    width: 100%;
    padding: 0.5rem 0.6rem;
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

  /* Bottom sheet on mobile — same shape as IdentityMenu.svelte's, pinned to
     the screen rather than the trigger so there's no edge left to run off. */
  @media (pointer: coarse), (max-width: 900px) {
    .download-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: var(--overlay);
      z-index: var(--z-menu);
      animation: download-backdrop-in var(--dur-fast) var(--ease);
    }
    .download-pop {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      top: auto;
      max-width: none;
      width: auto;
      transform: none;
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      padding: var(--sp-2) var(--sp-2) calc(var(--sp-2) + env(safe-area-inset-bottom));
      animation: download-sheet-in var(--dur-mid) var(--ease);
    }
    .download-sheet-grab {
      display: block;
      width: 32px;
      height: 4px;
      border-radius: var(--r-full);
      background: var(--border-strong);
      margin: 0 auto var(--sp-1);
    }
    .download-item {
      padding: 0.7rem 0.6rem;
    }
  }
  @keyframes download-backdrop-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes download-sheet-in {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
</style>
