<script lang="ts">
  // Tells the user whether the current room is *theirs* (a storage backend of
  // theirs is bound to it and autosaves it) or one they've merely joined as a
  // guest (live collaboration only — nothing of theirs persists it). When a
  // guest, the badge is a button that opens Settings so they can connect a
  // backend and claim the room.
  let {
    owner,
    label,
    onclick,
  }: {
    owner: boolean;
    label?: string;
    onclick?: () => void;
  } = $props();

  const title = $derived(
    owner
      ? `This room is yours — it autosaves to your ${label ?? 'storage'}.`
      : 'You’re a guest here — live collaboration only, nothing of yours saves this room. Connect a storage backend to make it yours.',
  );
</script>

<svelte:element
  this={onclick ? 'button' : 'span'}
  class="badge {owner ? 'owner' : 'guest'}"
  class:clickable={!!onclick}
  type={onclick ? 'button' : undefined}
  role={onclick ? undefined : 'status'}
  {title}
  {onclick}
>
  {#if owner}
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="4" /><path d="M11 11l6 6M15 15l2-2 3 3-2 2z" />
    </svg>
    <span class="badge-label">Owner</span>
  {:else}
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
    <span class="badge-label">Guest</span>
  {/if}
</svelte:element>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--r-full);
    font-size: var(--fs-300);
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
  }
  .badge.owner {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .badge.guest {
    color: var(--text-muted);
    background: var(--surface-3);
  }
  .badge.clickable {
    border: none;
    cursor: pointer;
  }
  .badge.clickable:hover {
    filter: brightness(0.96);
  }
  .badge svg {
    display: block;
  }
</style>
