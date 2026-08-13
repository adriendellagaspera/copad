<script lang="ts">
  import { fly } from 'svelte/transition';
  import Avatar from './Avatar.svelte';
  import type { PeerUser } from './types.js';
  import type { ClientId } from '../collaboration/types.js';

  let {
    users,
    max = 5,
    size = 28,
    onSelect,
    justJoinedIds = [],
  }: {
    users: PeerUser[];
    max?: number;
    size?: number;
    onSelect?: (clientId: ClientId) => void;
    /** Ids that should play the unlock moment's entrance (docs/contract.md §4.1:
     *  "the peer's avatar enters in their colour") — an already-present peer's
     *  avatar never re-triggers it. */
    justJoinedIds?: ClientId[];
  } = $props();

  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
</script>

<div
  class="presence"
  style="--overlap:{overlap}px"
  aria-label="{count} {count === 1 ? 'person' : 'people'} editing"
>
  {#each shown as u (u.id)}
    <div
      class="presence-item"
      in:fly={justJoinedIds.includes(u.id) && !reducedMotion ? { x: -8, duration: 250 } : { duration: 0 }}
    >
      {#if onSelect}
        <button
          type="button"
          class="presence-trigger"
          aria-label={u.self ? `Jump to your cursor` : `Jump to ${u.name}'s cursor`}
          onclick={() => onSelect(u.id)}
        >
          <Avatar name={u.name} color={u.color} {size} self={u.self} />
        </button>
      {:else}
        <Avatar name={u.name} color={u.color} {size} self={u.self} />
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
</style>
