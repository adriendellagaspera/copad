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
</script>

<div
  class="presence"
  style="--overlap:{overlap}px"
  aria-label="{count} {count === 1 ? 'person' : 'people'} editing"
>
  {#each shown as u (u.id)}
    <Avatar name={u.name} color={u.color} {size} self={u.self} />
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
  .presence :global(.avatar:not(:first-child)),
  .presence-more {
    margin-left: var(--overlap, -8px);
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
  }
</style>
