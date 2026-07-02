<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ConnStatus } from '../collaboration/types.js';

  let {
    conn,
    storageLabel,
    onShare,
  }: {
    conn: ConnStatus;
    /** The connected shared-storage backend's label, or null when there's none.
     *  Non-null ⟺ edits persist and will sync later; null ⟺ device-local only. */
    storageLabel: string | null;
    /** Open the Share dialog so the user can invite a collaborator. */
    onShare: () => void;
  } = $props();

  // `Waiting` = attached to signaling but no peers present — you're alone in the
  // room. Deliberately not shown for Connecting/Offline (those aren't "alone",
  // they're "not attached yet"), so the banner only speaks to real solitude.
  const alone = $derived(conn === ConnStatus.Waiting);
</script>

{#if alone}
  <div
    class="sync-banner"
    class:soft={storageLabel !== null}
    role="status"
    aria-live="polite"
    transition:slide={{ duration: 150 }}
  >
    <span class="dot" aria-hidden="true"></span>
    {#if storageLabel !== null}
      <span class="msg">
        <strong>Not syncing live — you're the only one here.</strong>
        Your edits are being saved to {storageLabel} and will sync when someone joins.
      </span>
    {:else}
      <span class="msg">
        <strong>Not syncing — you're the only one here.</strong>
        With no one else connected, edits stay on this device only and won't reach others.
      </span>
    {/if}
    <button class="link" onclick={onShare}>Invite someone</button>
  </div>
{/if}

<style>
  .sync-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    background: var(--warn-soft);
    border-bottom: 1px solid var(--warn-border);
    color: var(--warn);
    font-size: var(--fs-300);
    line-height: 1.4;
  }
  /* With a shared storage backend, being alone isn't a data-loss risk — soften
     to a neutral, informational tone rather than the warning palette. */
  .sync-banner.soft {
    background: var(--surface-2);
    border-bottom-color: var(--border);
    color: var(--text-muted);
  }
  .msg {
    flex: 1;
    min-width: 0;
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
  .sync-banner :global(button.link) {
    flex-shrink: 0;
    color: inherit;
    text-decoration: underline;
    font-weight: 600;
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
