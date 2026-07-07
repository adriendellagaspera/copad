<script lang="ts">
  import Avatar from './Avatar.svelte';
  import type { PeerUser } from './types.js';

  let { users, max = 5, size = 28 }: { users: PeerUser[]; max?: number; size?: number } = $props();

  const shown = $derived(users.slice(0, max));
  const overflow = $derived(Math.max(0, users.length - max));
  const overflowNames = $derived(
    users
      .slice(max)
      .map((u) => u.name)
      .join(', ')
  );
  const count = $derived(users.length);
  // Overlap scales with avatar size so the stack reads consistently at any
  // size — roughly a quarter of the diameter, matching the header capsule's
  // 24px/-7px spec.
  const overlap = $derived(-Math.round(size * 0.29));

  // Which peer's name popover is open, if any. Hover already surfaces the
  // name via Avatar's title, but that's unreachable on touch devices and
  // discoverable-by-accident on desktop — a click gives every input method
  // an explicit way to ask "who is this".
  let openId = $state<number | null>(null);
  let root = $state<HTMLDivElement | undefined>();

  function toggle(id: number): void {
    openId = openId === id ? null : id;
  }

  $effect(() => {
    if (openId === null) return;
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) openId = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openId = null;
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div
  class="presence"
  style="--overlap:{overlap}px"
  bind:this={root}
  aria-label="{count} {count === 1 ? 'person' : 'people'} editing"
>
  {#each shown as u (u.id)}
    <div class="presence-item">
      <button
        type="button"
        class="presence-trigger"
        aria-haspopup="true"
        aria-expanded={openId === u.id}
        aria-label={u.self ? `${u.name} (you)` : u.name}
        onclick={() => toggle(u.id)}
      >
        <Avatar name={u.name} color={u.color} {size} self={u.self} />
      </button>
      {#if openId === u.id}
        <div class="presence-pop" role="tooltip">{u.self ? `${u.name} (you)` : u.name}</div>
      {/if}
    </div>
  {/each}
  {#if overflow > 0}
    <span class="presence-more" style="--s:{size}px" title={overflowNames} aria-label="and {overflow} more: {overflowNames}">
      +{overflow}
    </span>
  {/if}
</div>

<style>
  .presence {
    display: flex;
    align-items: center;
  }
  .presence-item {
    position: relative;
    display: inline-flex;
  }
  .presence-item:not(:first-child) {
    margin-left: var(--overlap, -8px);
  }
  .presence-trigger {
    display: inline-flex;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: var(--r-full);
    cursor: pointer;
  }
  .presence-more {
    height: var(--s, 28px);
    min-width: var(--s, 28px);
    padding: 0 6px;
    border-radius: var(--r-full);
    background: var(--surface-3);
    color: var(--text-muted);
    box-shadow: 0 0 0 2px var(--surface);
    display: inline-grid;
    place-items: center;
    font-size: 0.72rem;
    font-weight: 600;
    user-select: none;
    margin-left: var(--overlap, -8px);
  }
  .presence-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-menu);
    white-space: nowrap;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
    padding: var(--sp-1) var(--sp-2);
    font-size: var(--fs-300);
    color: var(--text);
    animation: presence-pop-in var(--dur-fast) var(--ease);
  }
  @keyframes presence-pop-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>
