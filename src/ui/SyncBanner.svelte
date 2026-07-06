<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ConnStatus, Transport } from '../collaboration/types.js';

  let {
    conn,
    transport,
    storageLabel,
    gated = false,
    onShare,
    onConnectStorage,
  }: {
    conn: ConnStatus;
    /** How edits travel: peer-to-peer (nothing leaves the device while alone) or a
     *  hub relay (the server catches later joiners up). Calibrates the message. */
    transport: Transport;
    /** The label of the backend that saves *this room for you*, or null when the
     *  room is live-only for you. Non-null ⟺ a copy is kept in your own storage;
     *  null ⟺ this device (and its local cache) only. Mirrors the status chip's
     *  Saved / Live-only distinction — driven by `savedHere`, not merely by having
     *  a backend connected, so the copy is honest in rooms your backend doesn't save. */
    storageLabel: string | null;
    /** True when the write-gate is holding the editor read-only (P2P + live-only +
     *  alone). The gate owns that case, so the banner suppresses itself to avoid
     *  saying the same thing twice; it reappears if the user opts to write solo. */
    gated?: boolean;
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
  const isP2P = $derived(transport === Transport.P2P);
  // Strong (warning) tone only for the truly-into-the-void case: peer-to-peer and
  // live-only. That's the write-gate's territory — the banner only reaches it once
  // the user has opted to write solo, so it stays as a standing reminder.
  const strong = $derived(isP2P && !saved);
  const show = $derived(alone && !gated);
</script>

<!-- Presence-first solo state, calibrated to the collaboration mode (north-star:
     voice + paper). Writing alone is never blocked here (the write-gate handles the
     one case where it is), but the banner is honest about where edits go:
       • P2P + live-only  → strong: nothing leaves this device until someone joins.
       • P2P + saved      → medium: kept for you, but no one sees it live yet.
       • Hub (centralized)→ neutral: the server relays, so a later joiner catches up.
     It never implies an absent peer will see live edits before they join. -->
{#if show}
  <div
    class="sync-banner"
    class:soft={!strong}
    role="status"
    aria-live="polite"
    transition:slide={{ duration: 150 }}
  >
    <span class="dot" aria-hidden="true"></span>
    {#if !isP2P}
      <span class="msg">
        <strong>You're the only one here.</strong>
        Edits go through the server, so whoever joins later will catch up. Invite
        someone to write together now.
      </span>
      <span class="actions">
        <button class="invite-cta" onclick={onShare}>Invite</button>
      </span>
    {:else if saved}
      <span class="msg">
        <strong>You're writing alone.</strong>
        Kept for you in {storageLabel} — but a copy only you can open. No one sees your
        edits live until they join. Invite someone to co-edit.
      </span>
      <span class="actions">
        <button class="invite-cta" onclick={onShare}>Invite</button>
      </span>
    {:else}
      <span class="msg">
        <strong>You're writing to an empty room.</strong>
        In peer-to-peer mode nothing you write leaves this device until someone joins.
        Invite someone, or keep your own copy.
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
  /* Not into the void (saved, or a relaying hub) — soften to a neutral,
     informational tone rather than the warning palette. */
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
