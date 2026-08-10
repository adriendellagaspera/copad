<script lang="ts">
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { DisplayName } from '../collaboration/types.js';
  import { ConnStatus, PresenceKind, Transport } from '../collaboration/types.js';
  import {
    AloneVariant,
    BannerTierKind,
    BannerTone,
    bannerTierFor,
    bannerToneFor,
    tierSignature,
    type StorageLabel,
    type WaitingSinceLabel,
  } from './syncBannerTier.js';
  import type { EpochMs } from '../time.js';

  let {
    conn,
    presenceKind,
    transport,
    storageLabel,
    gated = false,
    gateEligible = false,
    collabUnavailable = false,
    waitingSince = null,
    departedPeerName = null,
    withinDepartureLinger = false,
    dismissible = true,
    onShare,
    onConnectStorage,
    onExport,
    onWriteSolo,
    onCopyInviteLink,
    onRetry,
    onConnectionDetails,
  }: {
    conn: ConnStatus;
    presenceKind: PresenceKind;
    transport: Transport;
    storageLabel: string | null;
    gated?: boolean;
    gateEligible?: boolean;
    collabUnavailable?: boolean;
    waitingSince?: EpochMs | null;
    departedPeerName?: string | null;
    withinDepartureLinger?: boolean;
    dismissible?: boolean;
    onShare: () => void;
    onConnectStorage: () => void;
    onExport?: () => void;
    onWriteSolo?: () => void;
    onCopyInviteLink?: () => void;
    onRetry?: () => void;
    onConnectionDetails?: () => void;
  } = $props();

  const waitingSinceLabel = $derived(
    waitingSince === null
      ? null
      : (new Date(waitingSince).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        }) as WaitingSinceLabel),
  );

  const tier = $derived(
    bannerTierFor({
      conn,
      presenceKind,
      transport,
      storageLabel: storageLabel as StorageLabel | null,
      gated,
      gateEligible,
      collabUnavailable,
      waitingSince: waitingSinceLabel,
      departedPeerName: departedPeerName as DisplayName | null,
      withinDepartureLinger,
    }),
  );
  const tone = $derived(bannerToneFor(tier));
  const signature = $derived(tierSignature(tier));

  let dismissed = $state(false);
  let expanded = $state(false);
  $effect(() => {
    signature;
    dismissed = false;
    expanded = false;
  });
  const show = $derived(tier.kind !== BannerTierKind.Hidden && !dismissed);

  // base.css's reduced-motion reset only catches CSS animations/transitions, not Svelte's JS ones.
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fades over the first 60%, not `slide`'s last 5%: below that height the border-radius looks wrong.
  function bannerOut(node: Element, { duration = 220 }: { duration?: number } = {}) {
    const style = getComputedStyle(node);
    const opacity = +style.opacity;
    const height = parseFloat(style.height);
    const paddingTop = parseFloat(style.paddingTop);
    const paddingBottom = parseFloat(style.paddingBottom);
    const marginTop = parseFloat(style.marginTop);
    const marginBottom = parseFloat(style.marginBottom);
    const borderTopWidth = parseFloat(style.borderTopWidth);
    const borderBottomWidth = parseFloat(style.borderBottomWidth);
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `
        overflow: hidden;
        opacity: ${Math.max(0, (t - 0.4) / 0.6) * opacity};
        height: ${t * height}px;
        padding-top: ${t * paddingTop}px;
        padding-bottom: ${t * paddingBottom}px;
        margin-top: ${t * marginTop}px;
        margin-bottom: ${t * marginBottom}px;
        border-top-width: ${t * borderTopWidth}px;
        border-bottom-width: ${t * borderBottomWidth}px;
        min-height: 0;
      `,
    };
  }
</script>

{#if show}
  <div
    class="sync-banner"
    class:soft={tone === BannerTone.Neutral}
    in:slide={{ duration: reducedMotion ? 0 : 150 }}
    out:bannerOut={{ duration: reducedMotion ? 0 : 220 }}
  >
    <span class="ic" aria-hidden="true">
      {#if tier.kind === BannerTierKind.Gated}
        <!-- Calm dot, not a spinner: a spinner promises imminence and lies after 30 seconds (contract §4.2). -->
        <span class="waiting-dot"></span>
      {:else}
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      {/if}
    </span>

    <!-- The live region is the sentence alone: opening the disclosure must not announce. -->
    <span class="msg" role="status" aria-live="polite">
      {#if tier.kind === BannerTierKind.Gated}
        <strong>You're the only one here.</strong>
        The document opens when someone joins.
        {#if tier.waitingSince}Waiting since {tier.waitingSince}.{/if}
      {:else if tier.kind === BannerTierKind.Reaching}
        <strong>Someone's here,</strong> still connecting to them.
      {:else if tier.kind === BannerTierKind.Departing}
        <strong>{tier.who} left.</strong>
        You can keep writing for a moment.
      {:else if tier.kind === BannerTierKind.Unreachable}
        We can't tell whether anyone else is here, so the document stays open.
      {:else if tier.kind === BannerTierKind.Offline}
        <strong>You're offline.</strong>
        The document stays open; nothing syncs until you're back.
      {:else if tier.kind === BannerTierKind.Unavailable}
        <strong>Real-time sync isn't available here.</strong>
        {#if tier.storageLabel}Your copy still goes to {tier.storageLabel}.{:else}Notes
          stay on this device only.{/if}
      {:else if tier.kind === BannerTierKind.Alone}
        {#if tier.variant === AloneVariant.Relayed}
          <strong>You're the only one here.</strong> Whoever joins later catches up.
        {:else if tier.variant === AloneVariant.Saved}
          <strong>You're writing alone.</strong> Kept for you in {tier.storageLabel}.
        {:else}
          <strong>You're writing alone.</strong> Nothing leaves this device yet.
        {/if}
      {/if}
    </span>

    {#if tier.kind === BannerTierKind.Gated}
      <span class="actions">
        {#if onCopyInviteLink}
          <button class="invite-cta" onclick={onCopyInviteLink}>Copy invite link</button>
        {/if}
        <button class="link" onclick={onConnectStorage}>Connect storage</button>
        {#if onExport}
          <button class="link" onclick={onExport}>Export a copy</button>
        {/if}
        {#if tier.transport === Transport.P2P && onWriteSolo}
          <button class="link write-solo" onclick={onWriteSolo}>Write alone anyway</button>
        {/if}
        <button
          class="more"
          aria-expanded={expanded}
          aria-controls="sync-banner-detail"
          onclick={() => (expanded = !expanded)}
        >
          Details
        </button>
      </span>
    {:else if tier.kind === BannerTierKind.Reaching}
      <span class="actions">
        {#if onRetry}
          <button class="link" onclick={onRetry}>Retry</button>
        {/if}
        {#if onConnectionDetails}
          <button class="link" onclick={onConnectionDetails}>Connection details</button>
        {/if}
      </span>
    {:else if tier.kind === BannerTierKind.Unavailable && !tier.storageLabel}
      <span class="actions">
        <button class="link" onclick={onConnectStorage}>Connect storage</button>
      </span>
    {:else if tier.kind === BannerTierKind.Alone}
      <span class="actions">
        <button class="invite-cta" onclick={onShare}>Invite</button>
        {#if tier.variant === AloneVariant.Void}
          <button class="link" onclick={onConnectStorage}>Connect storage</button>
        {/if}
        <button
          class="more"
          aria-expanded={expanded}
          aria-controls="sync-banner-detail"
          onclick={() => (expanded = !expanded)}
        >
          Details
        </button>
      </span>
    {/if}

    {#if dismissible}
      <button
        class="dismiss ghost"
        onclick={() => (dismissed = true)}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
      </button>
    {/if}

    <!-- Last in the flex row so it wraps onto its own line, at every width. -->
    {#if tier.kind === BannerTierKind.Gated}
      {#if expanded}
        <p class="aside" id="sync-banner-detail" transition:slide={{ duration: reducedMotion ? 0 : 150 }}>
          Until then you can read, copy and export it.
          {#if tier.transport === Transport.P2P}
            In peer-to-peer mode nothing you write leaves this device until someone
            receives it, so writing alone here would just be lost.
          {:else}
            The server keeps the list of who's present: when it says you're alone, you are.
          {/if}
        </p>
      {/if}
      {#if tier.transport === Transport.P2P && onWriteSolo}
        <p class="aside">
          Nothing you write leaves this device until someone joins.
        </p>
      {/if}
    {:else if tier.kind === BannerTierKind.Alone && expanded}
      <p class="aside" id="sync-banner-detail" transition:slide={{ duration: reducedMotion ? 0 : 150 }}>
        {#if tier.variant === AloneVariant.Relayed}
          Edits travel through the collaboration server, so anyone who joins later
          receives everything you write while alone.
        {:else if tier.variant === AloneVariant.Saved}
          A copy only you can open; nobody sees your edits live until they join.
        {:else}
          Peer-to-peer: your edits stay in this browser until someone joins, and the
          local cache dies with this browser profile. Connect storage to keep a copy
          of your own.
        {/if}
      </p>
    {/if}
  </div>
{/if}

<style>
  .sync-banner {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    padding: var(--sp-2) var(--sp-4);
    /* Reserve the corner the dismiss control is pinned to. */
    padding-right: 44px;
    /* Own margin, not the parent's flex gap: `slide` animates margin alongside height. */
    margin-bottom: var(--sp-4);
    background: color-mix(in srgb, var(--warn-soft) 55%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--warn-border) 55%, var(--border));
    border-radius: var(--r-md);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.4;
  }
  /* No mobile margin-top: that clearance is .app's own top padding (app.css) instead. */
  .sync-banner.soft {
    background: var(--surface-2);
    border-color: var(--border);
  }
  .ic {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: var(--warn);
  }
  .sync-banner.soft .ic {
    color: var(--text-muted);
  }
  .waiting-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .msg {
    flex: 1;
    min-width: 12rem;
    /* A peer display name is remote text and can be one unbroken token. */
    overflow-wrap: anywhere;
  }
  .msg strong {
    color: var(--text);
    font-weight: 600;
  }
  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .aside {
    flex: 1 0 100%;
    margin: 0;
    color: var(--text-faint);
    line-height: 1.45;
  }
  /* Pinned, not laid out: as a flex item it wrapped onto a line of its own once the actions filled the row. */
  .dismiss {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* >=44px hit area (WCAG 2.5.5) around a 13px glyph. */
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    color: var(--text-faint);
    border: none;
  }
  .dismiss:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }
  .invite-cta {
    padding: 0.34rem 0.9rem;
    border: 1px solid transparent;
    border-radius: var(--r-full);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: var(--fs-300);
    font-weight: 600;
    line-height: 1.4;
    cursor: pointer;
  }
  .invite-cta:hover {
    background: var(--accent-hover);
  }
  .more {
    flex-shrink: 0;
    min-height: 32px;
    padding: 0.34rem 0.4rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--fs-300);
    font-weight: 500;
    line-height: 1.4;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .more:hover {
    color: var(--text);
  }
  /* Touch needs the full 44px (WCAG 2.5.5); a mouse does not, and growing it everywhere would set the row's height off the other action chips. */
  @media (pointer: coarse) {
    .more {
      min-height: 44px;
    }
  }
  .sync-banner :global(button.link) {
    flex-shrink: 0;
    padding: 0.34rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-full);
    background: transparent;
    color: var(--text);
    text-decoration: none;
    font-size: var(--fs-300);
    font-weight: 600;
    line-height: 1.4;
    cursor: pointer;
  }
  .sync-banner :global(button.link:hover) {
    background: color-mix(in srgb, var(--text) 7%, transparent);
    border-color: var(--accent);
  }
</style>
