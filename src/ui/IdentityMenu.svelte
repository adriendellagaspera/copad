<script lang="ts">
  import Avatar from './Avatar.svelte';
  import type { DisplayName, CursorColor } from '../collaboration/types.js';

  // Your own identity (name + cursor colour) — the header capsule and the
  // mobile dock both mount one of these. Two presentations behind one
  // component, chosen by the same condition app.css's .mobile-dock uses to
  // switch chrome (pointer:coarse or a narrow viewport):
  //  - wide viewport / fine pointer: a small popover, anchored to the trigger
  //    and clamped to the viewport by `positionPopover()` (flips above the
  //    trigger, shifts horizontally) instead of assuming there's room below.
  //  - narrow viewport / coarse pointer: a bottom sheet pinned to the screen
  //    (never anchored to the trigger), so there is no edge left to run off —
  //    the old static `right:0` popover used to run past the left edge here,
  //    since the mobile dock's trigger sits flush against the screen's left.
  // Peer avatars deliberately do NOT use this component: PresenceBar's own
  // "jump to cursor" button is a single, instant tap (matching Figma/Google
  // Docs), and the only place a peer avatar is reachable on mobile is nested
  // inside ConnectionDialog's own bottom sheet — stacking a second bottom
  // sheet/backdrop in there produced a real double-scrim bug. See PR #180's
  // follow-up.
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
  // Tracked reactively (not just read ad hoc) so the template can gate
  // role/aria-modal/focus-trap/scroll-lock on the same signal the CSS
  // breakpoint uses — the sheet presentation is the only one that visually
  // blocks the rest of the page, so it's the only one that should behave
  // modally.
  let compact = $state(false);

  const isDefault = $derived(!name || name === 'Anonymous');

  function isCompact(): boolean {
    return window.matchMedia('(pointer: coarse), (max-width: 900px)').matches;
  }

  // The viewport-aware placement: measure the panel once in its default
  // (below, unshifted) position and correct only the axes that actually
  // overflow. A no-op on the compact breakpoint, where CSS pins the panel to
  // the bottom of the screen instead.
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

  // Tracks the breakpoint continuously (not just at open time) so a resize/
  // rotate while the panel is open — or before it's ever opened — keeps
  // `compact` truthful for the role/aria-modal it drives.
  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse), (max-width: 900px)');
    compact = mql.matches;
    const onChange = (e: MediaQueryListEvent) => { compact = e.matches; };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  // Same tab-trap shape as Dialog.svelte, scoped to the panel instead of a
  // whole dialog. Only wired up while `compact` — the desktop popover has no
  // backdrop and was never meant to behave modally (see the "role" binding
  // below), so trapping Tab there would be an unrequested behaviour change.
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
    // The compact sheet has a full-viewport backdrop like Dialog.svelte's —
    // lock background scroll to match, so the page behind it can't scroll
    // while it visually reads as blocking the rest of the screen. The desktop
    // popover has no backdrop, so it doesn't need this.
    if (compact) document.body.style.overflow = 'hidden';
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
    // Capture phase so we see Escape before any other in-page listener (or a
    // browser-extension content script on the autofocused name input, e.g. a
    // password manager) gets a chance to stopPropagation() or otherwise
    // swallow the first press.
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
    <!-- role/aria-modal follow `compact`: the mobile sheet has a full-viewport
         backdrop and reads as blocking the rest of the page, so it announces
         and traps focus like Dialog.svelte's dialogs do. The desktop popover
         has no backdrop and was never meant to behave modally. -->
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
    /* A custom property, not a `transform` set directly inline: the compact
       media query below never references --shift-x, so it can't be fought by
       an inline style the way a directly-bound `style="transform: ..."`
       would fight a plain `transform: none` stylesheet rule (inline always
       wins over a stylesheet declaration for the same property, media query
       or not). This is what actually lets the compact rule win on mobile. */
    transform: translateX(var(--shift-x, 0px));
    animation: identity-in var(--dur-fast) var(--ease);
  }
  /* Auto-flip when the measured panel would run past the bottom of the
     viewport (positionPopover), rather than a caller-supplied placement prop
     tuned per call site. */
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

  /* Bottom sheet: pinned to the screen, never to the trigger, so there is no
     edge left to run off. Same condition app.css's .mobile-dock uses to
     switch chrome. Deliberately doesn't reference --shift-x/transform at all
     (see the comment on .identity-pop above) so the desktop positioning
     logic can't leak through here. */
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
