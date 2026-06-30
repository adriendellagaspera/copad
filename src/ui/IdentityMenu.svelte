<script lang="ts">
  import Avatar from './Avatar.svelte';
  import type { DisplayName, CursorColor } from '../collaboration/types.js';

  type Props = {
    name: DisplayName;
    color: CursorColor;
    colors: CursorColor[];
    onName: (raw: string) => void;
    onColor: (color: CursorColor) => void;
  };

  let { name, color, colors, onName, onColor }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | undefined>();

  // Focus the name field when the popover opens (it mounts on open), without the
  // a11y-flagged `autofocus` attribute.
  function focusOnMount(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }

  // Hint first-time users that their avatar is where they set their name.
  const isDefault = $derived(!name || name === 'Anonymous');

  $effect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="identity" bind:this={root}>
  <button
    class="identity-btn"
    class:hint={isDefault}
    aria-haspopup="dialog"
    aria-expanded={open}
    title="You — click to set your name & colour"
    aria-label="Your identity — click to edit"
    onclick={() => (open = !open)}
  >
    <Avatar name={name} color={color} self />
    {#if isDefault}<span class="identity-hint">Set name</span>{/if}
  </button>

  {#if open}
    <div class="identity-pop" role="dialog" aria-label="Your identity">
      <label class="identity-field">
        <span>Your name</span>
        <input
          use:focusOnMount
          placeholder="Your name"
          value={name === 'Anonymous' ? '' : name}
          oninput={(e) => onName(e.currentTarget.value)}
          onkeydown={(e) => e.key === 'Enter' && (open = false)}
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

  .identity-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--z-menu);
    min-width: 15rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
    padding: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    animation: identity-in var(--dur-fast) var(--ease);
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
</style>
