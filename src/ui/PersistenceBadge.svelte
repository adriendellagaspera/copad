<script lang="ts">
  // Tells the user whether the current room is saved to *their own* storage
  // backend, or is live-only for them (real-time collaboration + local cache,
  // but nothing of theirs persists it durably). No one "owns" a room: with
  // per-target autosave, anyone who connects a backend keeps their own saved copy —
  // so this is a per-user statement about *your* persistence, not a role.
  //
  // North-star metaphor (voice / paper): a live session is *voice* — heard only by
  // people present now; a saved copy is *paper in your pocket* — kept for you, but
  // not readable by peers who arrive later. The copy here never promises that an
  // absent collaborator will see your work; it only states what is kept for *you*.
  //
  // On mobile the badge carries an inline detail so the distinction is legible at a
  // glance without a tap; on wider screens the detail collapses to the hover title.
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

  const where = $derived(label ?? 'your storage');

  // Short suffix shown inline on mobile — states the meaning in plain, honest terms.
  const detail = $derived(
    warning ? 'same file as another room' : saved ? `kept in ${where}` : 'not kept for you',
  );

  const title = $derived(
    warning
      ? warning
      : saved
        ? `Kept for you — this room autosaves to your ${where}. Collaborators edit live but can’t write to your storage, and peers who join later won’t see it unless they’re here now.`
        : 'Live-only — shared with people here now, but nothing is kept for you (real-time collaboration + a local cache only). Connect a storage backend to keep your own copy.',
  );
</script>

<svelte:element
  this={onclick ? 'button' : 'span'}
  class="persistence-badge {warning ? 'conflict' : saved ? 'saved' : 'live'}"
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
  <span class="badge-detail">{detail}</span>
</svelte:element>

<style>
  /* Own class (not the generic `.badge` used by Settings backend pills) so the
     component fully owns its look — no accidental uppercase / border bleed. */
  .persistence-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    border: none;
    border-radius: var(--r-full);
    font-size: var(--fs-300);
    font-weight: 500;
    line-height: 1.4;
    text-transform: none;
    letter-spacing: normal;
    white-space: nowrap;
  }
  .persistence-badge.saved {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .persistence-badge.live {
    color: var(--text-muted);
    background: var(--surface-3);
  }
  .persistence-badge.conflict {
    color: var(--danger);
    background: var(--danger-soft);
  }
  .persistence-badge.clickable {
    cursor: pointer;
  }
  .persistence-badge.clickable:hover {
    filter: brightness(0.96);
  }
  .persistence-badge svg {
    display: block;
  }
  /* The inline detail is the mobile-legible half: it spells out the distinction
     without a tap. On wider screens the header stays compact and the detail lives
     in the hover title instead. */
  .badge-detail {
    display: none;
    font-weight: 400;
    opacity: 0.85;
  }
  .badge-detail::before {
    content: "·";
    margin-right: 0.3rem;
    opacity: 0.7;
  }
  @media (max-width: 720px) {
    .persistence-badge {
      font-size: var(--fs-400, 0.9375rem);
      padding: 0.3rem 0.7rem;
    }
    .badge-detail {
      display: inline;
    }
  }
</style>
