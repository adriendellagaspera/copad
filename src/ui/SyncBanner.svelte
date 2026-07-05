<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ConnStatus } from '../collaboration/types.js';

  let {
    conn,
    storageLabel,
    onShare,
    onConnectStorage,
  }: {
    conn: ConnStatus;
    /** The label of the backend that saves *this room for you*, or null when the
     *  room is live-only for you. Non-null ⟺ a copy is kept in your own storage;
     *  null ⟺ this device (and its local cache) only. Mirrors PersistenceBadge's
     *  Saved / Live-only distinction — driven by `savedHere`, not merely by having
     *  a backend connected, so the copy is honest in rooms your backend doesn't save. */
    storageLabel: string | null;
    /** Open the Share dialog so the user can invite a collaborator. */
    onShare: () => void;
    /** Open Settings so the user can connect a backend to keep their own copy. */
    onConnectStorage: () => void;
  } = $props();

  // `Waiting` = attached to signaling but no peers present — you're alone in the
  // room. Deliberately not shown for Connecting/Offline (those aren't "alone",
  // they're "not attached yet"), so the banner only speaks to real solitude.
  const alone = $derived(conn === ConnStatus.Waiting);
  const saved = $derived(storageLabel !== null);
</script>

<!-- Presence-first solo state (north-star: voice + paper). Being alone is never
     blocked — writing solo is fine — but the banner is honest about durability,
     and its copy adapts to whether the room is Saved or Live-only for you. It never
     implies that a peer who joins later will see your work: a live session is heard
     only by people present now. -->
{#if alone}
  <div
    class="sync-banner"
    class:soft={saved}
    role="status"
    aria-live="polite"
    transition:slide={{ duration: 150 }}
  >
    <span class="dot" aria-hidden="true"></span>
    {#if saved}
      <span class="msg">
        <strong>You're writing alone.</strong>
        Kept for you in {storageLabel} — but a copy only you can open. Invite someone to
        write together in real time.
      </span>
      <span class="actions">
        <button class="invite-cta" onclick={onShare}>Invite</button>
      </span>
    {:else}
      <span class="msg">
        <strong>You're the only one here.</strong>
        These notes stay on this device — no one else can see them, and they won't reach
        anyone who joins later. Invite someone, or keep your own copy.
      </span>
      <span class="actions">
        <button class="invite-cta" onclick={onShare}>Invite</button>
        <button class="link" onclick={onConnectStorage}>Connect storage</button>
      </span>
    {/if}
  </div>
{/if}

<style>
  .sync-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    padding: var(--sp-2) var(--sp-4);
    background: var(--warn-soft);
    border-bottom: 1px solid var(--warn-border);
    color: var(--warn);
    font-size: var(--fs-300);
    line-height: 1.4;
  }
  /* With your own saved copy, being alone isn't a data-loss risk — soften to a
     neutral, informational tone rather than the warning palette. */
  .sync-banner.soft {
    background: var(--surface-2);
    border-bottom-color: var(--border);
    color: var(--text-muted);
  }
  .msg {
    flex: 1;
    min-width: 12rem;
  }
  .msg strong {
    font-weight: 600;
  }
  .dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: var(--r-full);
    background: currentColor;
    animation: pulse 2s ease-in-out infinite;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-shrink: 0;
  }
  /* Primary CTA — a filled chip so "Invite" reads as the obvious next step, not a
     buried text link. Uses currentColor so it inherits the warn/neutral tone. */
  .invite-cta {
    padding: 0.25rem 0.75rem;
    border: 1px solid currentColor;
    border-radius: var(--r-full);
    background: transparent;
    color: inherit;
    font-size: var(--fs-300);
    font-weight: 600;
    line-height: 1.4;
    cursor: pointer;
  }
  .invite-cta:hover {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .sync-banner :global(button.link) {
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    font-size: var(--fs-300);
    font-weight: 600;
    cursor: pointer;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
</style>
