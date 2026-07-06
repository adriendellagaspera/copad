<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ConnStatus, Transport } from '../collaboration/types.js';

  let {
    conn,
    transport,
    storageLabel,
    gated = false,
    gateEligible = false,
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
     *  no peer, past the grace window). The gate has no separate surface anymore — it
     *  lives *here*, as the strongest tier of this one top strip: same slot,
     *  escalating intensity. When gated the editor is read-only and yields on the
     *  first writing gesture; this strip tells you that, and offers Invite / Connect. */
    gated?: boolean;
    /** True while the gate *could* still arm — the pre-arm grace window (P2P +
     *  live-only + no peer, not yet opted solo). During it we show nothing: the
     *  standing solo reminder would be premature (you haven't chosen to write solo),
     *  and the gate hasn't armed. Distinguishes "grace pending" from "opted solo",
     *  which otherwise look identical (both: alone, editable). */
    gateEligible?: boolean;
    /** Open the Share dialog so the user can invite a collaborator. */
    onShare: () => void;
    /** Open Settings so the user can connect a backend to keep their own copy. */
    onConnectStorage: () => void;
  } = $props();

  // `Waiting` = attached to signaling but no peers present — you're alone in the
  // room. Deliberately not shown for Connecting/Offline (those aren't "alone",
  // they're "not attached yet"), so the standing banner only speaks to real solitude.
  const alone = $derived(conn === ConnStatus.Waiting);
  const offline = $derived(conn === ConnStatus.Offline);
  const saved = $derived(storageLabel !== null);
  const isP2P = $derived(transport === Transport.P2P);
  // Strong (warning) tone for the truly-into-the-void case: peer-to-peer and
  // live-only. That covers the gated tier (always P2P + live-only) and the standing
  // solo reminder once you've opted to write there.
  const strong = $derived(isP2P && !saved);
  // One top strip, two intensities: the gate (read-only, yielding on write) when
  // `gated`; else the standing solo reminder when alone AND no longer gate-pending
  // (you've opted to write solo, or the room is saved / on a hub and was never
  // gateable). Nothing during the grace window. Same slot either way.
  const show = $derived(gated || (alone && !gateEligible));
</script>

<!-- Presence-first solo state, one strip that escalates (north-star: voice + paper;
     the interface recedes in front of the text — never a scrim over it). Two tiers:
       • gated → the write-gate: editor read-only, "start writing to write solo".
       • alone → a standing reminder, calibrated to where edits go (P2P live-only /
         P2P saved / hub), once you've opted to write on your own.
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
    {#if gated}
      <span class="msg">
        {#if offline}
          <strong>You're offline.</strong>
          Start writing to write on your own — nothing leaves this device until you're
          back and someone joins.
        {:else}
          <strong>You're the only one here.</strong>
          Start writing to write on your own — but in peer-to-peer mode nothing leaves
          this device until someone joins.
        {/if}
      </span>
      <span class="actions">
        <button class="invite-cta" onclick={onShare}>Invite</button>
        <button class="link" onclick={onConnectStorage}>Connect storage</button>
      </span>
    {:else if !isP2P}
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
