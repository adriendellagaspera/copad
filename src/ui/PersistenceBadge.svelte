<script lang="ts">
  // Tells the user whether the current room is saved to *their own* storage
  // backend, or is live-only for them (real-time collaboration + local cache,
  // but nothing of theirs persists it durably). There is no single room "owner":
  // with per-target autosave, anyone who connects a backend keeps their own saved
  // copy — so this is a per-user statement about *your* persistence, not a role.
  // When live-only, the badge is a button that opens Settings to connect a backend.
  let {
    saved,
    label,
    warning,
    onclick,
  }: {
    saved: boolean;
    label?: string;
    /** A file-collision warning (another room saves to the same file). When set,
     *  the badge shows a conflict state regardless of `saved`. */
    warning?: string;
    onclick?: () => void;
  } = $props();

  const title = $derived(
    warning
      ? warning
      : saved
        ? `This room autosaves to your ${label ?? 'storage'}. Collaborators edit live but can’t write to your storage.`
        : 'Live-only for you — real-time collaboration + local cache, but nothing of yours saves this room. Connect a storage backend to save it to your own storage.',
  );
</script>

<svelte:element
  this={onclick ? 'button' : 'span'}
  class="badge {warning ? 'conflict' : saved ? 'saved' : 'live'}"
  class:clickable={!!onclick}
  type={onclick ? 'button' : undefined}
  role={onclick ? undefined : 'status'}
  {title}
  {onclick}
>
  {#if warning}
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
    </svg>
    <span class="badge-label">Conflict</span>
  {:else if saved}
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
    <span class="badge-label">Saved</span>
  {:else}
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
    <span class="badge-label">Live-only</span>
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
  .badge.saved {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .badge.live {
    color: var(--text-muted);
    background: var(--surface-3);
  }
  .badge.conflict {
    color: var(--danger);
    background: var(--danger-soft);
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
