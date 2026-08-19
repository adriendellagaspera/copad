<script lang="ts">
  import Avatar from './Avatar.svelte';
  import type { DisplayName, CursorColor } from '../collaboration/types.js';

  // Popover (fine pointer) vs. bottom sheet (coarse/narrow), matching app.css's .mobile-capsule condition.
  // Peer avatars skip this: nesting a bottom sheet inside ConnectionDialog's caused a double-scrim bug (PR #180).
  type Props = {
    name: DisplayName;
    color: CursorColor;
    colors: CursorColor[];
    size?: number;
    onName: (raw: string) => void;
    onColor: (color: CursorColor) => void;
  };

  let { name, color, colors, size = 28, onName, onColor }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | undefined>();
  let triggerBtn = $state<HTMLButtonElement | undefined>();
  let panelEl = $state<HTMLDivElement | undefined>();

  let flipAbove = $state(false);
  let shiftX = $state(0);
  let compact = $state(false);

  const isDefault = $derived(!name || name === 'Anonymous');

  function isCompact(): boolean {
    return window.matchMedia('(pointer: coarse), (max-width: 900px)').matches;
  }

  // No-op on the compact breakpoint, where CSS pins the panel to the bottom of the screen instead.
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

  function focusOnMount(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }

  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse), (max-width: 900px)');
    compact = mql.matches;
    const onChange = (e: MediaQueryListEvent) => { compact = e.matches; };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  // Only wired up while compact: the desktop popover has no backdrop and was never meant to behave modally.
  function trapTab(e: KeyboardEvent): void {
    if (!compact || e.key !== 'Tab' || !panelEl) return;
    const f = panelEl.querySelectorAll<HTMLElement>(
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
    positionPopover();
    if (compact) document.body.style.overflow = 'hidden';
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndReturnFocus();
    };
    // Capture phase: Escape must be seen before a page listener or extension (e.g. password manager) swallows it.
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

<div class="identity" bind:this={root}>
  <button
    bind:this={triggerBtn}
    class="identity-btn"
    class:hint={isDefault}
    aria-haspopup="true"
    aria-expanded={open}
    title="You — click to set your name & colour"
    aria-label="Your identity — click to edit"
    onclick={() => (open = !open)}
  >
    <Avatar {name} {color} {size} self />
    {#if isDefault}<span class="identity-hint">Set name</span>{/if}
  </button>

  {#if open}
    <div class="identity-backdrop" onclick={closeAndReturnFocus} aria-hidden="true"></div>
    <div
      class="identity-pop"
      class:above={flipAbove}
      style="--shift-x: {shiftX}px"
      bind:this={panelEl}
      role={compact ? 'dialog' : 'group'}
      aria-modal={compact ? 'true' : undefined}
      aria-label="Your identity"
      onkeydown={trapTab}
    >
      <div class="identity-sheet-grab" aria-hidden="true"></div>
      <label class="identity-field">
        <span>Your name</span>
        <input
          use:focusOnMount
          placeholder="Your name"
          value={name === 'Anonymous' ? '' : name}
          oninput={(e) => onName(e.currentTarget.value)}
          onkeydown={(e) => e.key === 'Enter' && closeAndReturnFocus()}
        />
      </label>
      <div class="identity-field">
        <span>Cursor colour</span>
        <div class="swatches">
          {#each colors as c (c)}
            <button
              class="swatch"
              class:selected={c === color}
              style="--c:{c}"
              title={c}
              aria-label={'Use colour ' + c}
              aria-pressed={c === color}
              onclick={() => onColor(c)}
            ></button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .identity {
    position: relative;
    display: inline-flex;
  }
  .identity-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 0;
    border: none;
    background: transparent;
    padding: 0.1rem;
    border-radius: var(--r-full);
    cursor: pointer;
  }
  .identity-btn:hover {
    background: var(--surface-3);
  }
  .identity-btn.hint {
    background: var(--surface-3);
    padding-right: 0.5rem;
  }
  .identity-hint {
    font-size: var(--fs-300);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .identity-backdrop {
    display: none;
  }

  .identity-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: var(--z-menu);
    min-width: 15rem;
    max-width: calc(100vw - 16px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
    padding: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    /* Custom property, not a directly-bound style="transform:...": an inline transform would beat the compact media query's plain `transform: none` rule (inline always wins), since the query never references --shift-x. */
    transform: translateX(var(--shift-x, 0px));
    animation: identity-in var(--dur-fast) var(--ease);
  }
  .identity-pop.above {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .identity-sheet-grab {
    display: none;
  }
  @keyframes identity-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .identity-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: var(--fs-300);
    color: var(--text-muted);
  }
  .identity-field input {
    width: 100%;
  }
  .swatches {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }
  .swatch {
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: var(--r-full);
    background: var(--c);
    border: 2px solid transparent;
    cursor: pointer;
  }
  .swatch.selected {
    border-color: var(--text);
    box-shadow: 0 0 0 2px var(--surface);
  }

  @media (pointer: coarse), (max-width: 900px) {
    .identity-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: var(--overlay);
      z-index: var(--z-menu);
      animation: identity-backdrop-in var(--dur-fast) var(--ease);
    }
    .identity-pop {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      top: auto;
      max-width: none;
      min-width: 0;
      transform: none;
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      padding: var(--sp-2) var(--sp-4) calc(var(--sp-4) + env(safe-area-inset-bottom));
      animation: identity-sheet-in var(--dur-mid) var(--ease);
    }
    .identity-sheet-grab {
      display: block;
      width: 32px;
      height: 4px;
      border-radius: var(--r-full);
      background: var(--border-strong);
      margin: 0 auto var(--sp-1);
    }
  }
  @keyframes identity-backdrop-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes identity-sheet-in {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
</style>
