<script lang="ts">
  import Avatar from './Avatar.svelte';
  import type { PeerUser } from './types.js';
  import { useI18n } from '../i18n/index.svelte.js';

  let { users, max = 5 }: { users: PeerUser[]; max?: number } = $props();

  const i18n = useI18n();
  const t = $derived(i18n.t);

  const shown = $derived(users.slice(0, max));
  const overflow = $derived(Math.max(0, users.length - max));
  const overflowNames = $derived(
    users
      .slice(max)
      .map((u) => u.name)
      .join(', ')
  );
  const count = $derived(users.length);
</script>

<div
  class="presence"
  aria-label={t.presence.editing(count)}
>
  {#each shown as u (u.id)}
    <Avatar name={u.name} color={u.color} self={u.self} />
  {/each}
  {#if overflow > 0}
    <span class="presence-more" title={overflowNames} aria-label={t.presence.more(overflow, overflowNames)}>
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
    margin-left: -8px;
  }
  .presence-more {
    height: 28px;
    min-width: 28px;
    padding: 0 6px;
    border-radius: var(--r-full);
    background: var(--surface-3);
    color: var(--text-muted);
    box-shadow: 0 0 0 2px var(--surface-2);
    display: inline-grid;
    place-items: center;
    font-size: 0.72rem;
    font-weight: 600;
    user-select: none;
  }
</style>
