<script lang="ts">
  import Avatar from './Avatar.svelte';
  import type { DisplayName, CursorColor } from '../collaboration/types.js';

  // Same trigger + panel for both "you" and a peer's avatar. Anchored — never
  // fixed to a screen edge like the old IdentityMenu's static right:0 — so it
  // works wherever the trigger sits (header capsule, mobile dock, presence
  // bar at either end). Two presentations behind one component:
  //  - wide viewport / fine pointer: a small popover, anchored to the trigger
  //    and clamped to the viewport by `positionPopover()` (flips above the
  //    trigger, shifts horizontally) instead of assuming there's room below-right.
  //  - narrow viewport / coarse pointer (same condition app.css's
  //    .mobile-dock uses): a bottom sheet pinned to the screen, so there is no
  //    edge left to run off — this is what actually fixes the mobile overflow.
  type Props = {
    name: DisplayName;
    color: CursorColor;
    /** Renders the "you" content (name + colour editing) instead of a peer's. */
    self?: boolean;
    size?: number;
    /** Needed only to offer colour editing (self mode). */
    colors?: CursorColor[];
    onName?: (raw: string) => void;
    onColor?: (color: CursorColor) => void;
    /** "Jump to cursor" action (peer mode). Omit to render a plain, non-interactive avatar. */
    onJump?: () => void;
  };

  let { name, color, self = false, size = 28, colors = [], onName, onColor, onJump }: Props = $props();

  // Editable identity fields take priority when available (the header/dock
  // "you" chip); otherwise fall back to the jump action if one was wired up
  // — including for a self entry with no editing available (e.g. "everyone,
  // including you" in ConnectionDialog's presence row, where jumping to your
  // own cursor is still a meaningful action). No action at all (a peer chip
  // with no onSelect) is just a static avatar, matching the previous fallback.
  const canEdit = $derived(self && Boolean(onName || onColor));
  const interactive = $derived(canEdit || Boolean(onJump));

  let open = $state(false);
  let root = $state<HTMLDivElement | undefined>();
  let triggerBtn = $state<HTMLButtonElement | undefined>();
  let panelEl = $state<HTMLDivElement | undefined>();

  let flipAbove = $state(false);
  let shiftX = $state(0);

  const isDefault = $derived(canEdit && (!name || name === 'Anonymous'));

  function isCompact(): boolean {
    return window.matchMedia('(pointer: coarse), (max-width: 900px)').matches;
  }

  // The viewport-aware placement the popover mockup called for: measure the
  // panel once in its default (below, unshifted) position and correct only
  // the axes that actually overflow. A no-op on the compact breakpoint, where
  // CSS pins the panel to the bottom of the screen instead.
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
    if (!open) return;
    positionPopover();
    const onDown = (e: MouseEvent) => {
      // An outside click already moves focus wherever the user clicked (or
      // leaves it on body for a non-focusable area) — don't fight that by
      // yanking focus back to the trigger.
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape has no focus target of its own, so return focus to the trigger.
      if (e.key === 'Escape') closeAndReturnFocus();
    };
    // Capture phase so we see Escape (and this reposition) before any other
    // in-page listener — see IdentityMenu's original comment on password
    // managers / extension content scripts stealing the first keydown.
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', positionPopover);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', positionPopover);
    };
  });

  function jump(): void {
    onJump?.();
    closeAndReturnFocus();
  }
</script>

{#if !interactive}
  <Avatar {name} {color} {size} {self} />
{:else}
  <div class="pip" bind:this={root}>
    <button
      bind:this={triggerBtn}
      class="pip-btn"
      class:hint={isDefault}
      aria-haspopup="true"
      aria-expanded={open}
      title={canEdit ? 'You — click to set your name & colour' : `${name} — click for details`}
      aria-label={canEdit ? 'Your identity — click to edit' : `${name} — click for details`}
      onclick={() => (open = !open)}
    >
      <Avatar {name} {color} {size} {self} />
      {#if isDefault}<span class="pip-hint">Set name</span>{/if}
    </button>

    {#if open}
      <!-- role="group", not "dialog": a small set of related controls, not a
           modal — no focus trap, shouldn't announce as one, even in the
           mobile sheet presentation. -->
      <div class="pip-backdrop" onclick={closeAndReturnFocus} aria-hidden="true"></div>
      <div
        class="pip-panel"
        class:above={flipAbove}
        style="transform: translateX({shiftX}px)"
        bind:this={panelEl}
        role="group"
        aria-label={self ? 'Your identity' : `${name}'s presence`}
      >
        <div class="pip-sheet-grab" aria-hidden="true"></div>
        <div class="pip-head">
          <Avatar {name} {color} size={36} {self} />
          <div class="pip-name">{name}{self ? ' (you)' : ''}</div>
        </div>

        {#if canEdit}
          <label class="pip-field">
            <span>Your name</span>
            <input
              use:focusOnMount
              placeholder="Your name"
              value={name === 'Anonymous' ? '' : name}
              oninput={(e) => onName?.(e.currentTarget.value)}
              onkeydown={(e) => e.key === 'Enter' && closeAndReturnFocus()}
            />
          </label>
          {#if colors.length > 0}
            <div class="pip-field">
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
                    onclick={() => onColor?.(c)}
                  ></button>
                {/each}
              </div>
            </div>
          {/if}
        {:else if onJump}
          <button class="pip-jump" onclick={jump}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            Jump to cursor
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .pip {
    position: relative;
    display: inline-flex;
  }
  .pip-btn {
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
  .pip-btn:hover {
    background: var(--surface-3);
  }
  .pip-btn.hint {
    background: var(--surface-3);
    padding-right: 0.5rem;
  }
  .pip-hint {
    font-size: var(--fs-300);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .pip-backdrop {
    display: none;
  }

  .pip-panel {
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
    animation: pip-in var(--dur-fast) var(--ease);
  }
  /* Auto-flip when the measured panel would run past the bottom of the
     viewport (positionPopover), rather than a caller-supplied placement prop
     tuned per call site. */
  .pip-panel.above {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .pip-sheet-grab {
    display: none;
  }
  @keyframes pip-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .pip-head {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .pip-name {
    font-size: var(--fs-400);
    font-weight: 600;
  }
  .pip-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: var(--fs-300);
    color: var(--text-muted);
  }
  .pip-field input {
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
  .pip-jump {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    font-size: var(--fs-300);
    font-weight: 600;
    padding: 0.5rem 0.7rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }
  .pip-jump:hover {
    background: var(--surface-3);
  }

  /* Bottom sheet: pinned to the screen, never to the trigger, so there is no
     edge left for it to run off. Same condition app.css's .mobile-dock uses
     to switch chrome — the JS clamp above deliberately no-ops here. */
  @media (pointer: coarse), (max-width: 900px) {
    .pip-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: var(--overlay);
      z-index: var(--z-menu);
      animation: pip-backdrop-in var(--dur-fast) var(--ease);
    }
    .pip-panel {
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
      animation: pip-sheet-in var(--dur-mid) var(--ease);
    }
    .pip-sheet-grab {
      display: block;
      width: 32px;
      height: 4px;
      border-radius: var(--r-full);
      background: var(--border-strong);
      margin: 0 auto var(--sp-1);
    }
    .pip-head {
      margin-bottom: var(--sp-1);
    }
  }
  @keyframes pip-backdrop-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes pip-sheet-in {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
</style>
