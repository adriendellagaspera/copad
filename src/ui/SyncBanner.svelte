<script lang="ts">
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { ConnStatus, PresenceKind, Transport } from '../collaboration/types.js';
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
    onShare,
    onConnectStorage,
    onExport,
    onWriteSolo,
    onCopyInviteLink,
    onRetry,
    onConnectionDetails,
  }: {
    conn: ConnStatus;
    // Distinguishes Alone (gate holds) from Reaching (unreachable, never gates) within ConnStatus.Waiting. docs/contract.md §4.
    presenceKind: PresenceKind;
    transport: Transport;
    // Non-null iff a copy is kept in the user's own storage (driven by savedHere, not merely "backend connected").
    storageLabel: string | null;
    // docs/contract.md §4.2: write gate active.
    gated?: boolean;
    // Pre-arm grace window (P2P + live-only + no peer, not yet opted solo): nothing shown yet.
    gateEligible?: boolean;
    // Permanent deployment fact (no signaling server, or mixed-content ws://), not a transient "no peer yet" state.
    collabUnavailable?: boolean;
    waitingSince?: EpochMs | null;
    departedPeerName?: string | null;
    withinDepartureLinger?: boolean;
    onShare: () => void;
    onConnectStorage: () => void;
    onExport?: () => void;
    onWriteSolo?: () => void;
    onCopyInviteLink?: () => void;
    onRetry?: () => void;
    onConnectionDetails?: () => void;
  } = $props();

  const offline = $derived(conn === ConnStatus.Offline);
  const unreachableNet = $derived(conn === ConnStatus.Unreachable);
  const reaching = $derived(!gated && presenceKind === PresenceKind.Reaching);
  const departing = $derived(!gated && !reaching && withinDepartureLinger);
  const aloneStanding = $derived(conn === ConnStatus.Waiting && presenceKind !== PresenceKind.Reaching);
  const saved = $derived(storageLabel !== null);
  const isP2P = $derived(transport === Transport.P2P);
  // Warning tone for the truly-into-the-void case (P2P + live-only); collabUnavailable stays neutral since it's a permanent fact, not an actionable warning.
  const strong = $derived(!collabUnavailable && isP2P && !saved && !reaching && !departing && !unreachableNet);

  // One escalation ladder, same slot throughout: gate → reaching/departing/unreachable/offline → collab-unavailable → standing solo reminder.
  const wantShow = $derived(
    gated ||
      reaching ||
      departing ||
      unreachableNet ||
      offline ||
      collabUnavailable ||
      (aloneStanding && !gateEligible),
  );

  const reason = $derived(
    !wantShow
      ? 'hidden'
      : gated
        ? 'gated'
        : reaching
          ? 'reaching'
          : departing
            ? 'departing'
            : unreachableNet
              ? 'unreachable'
              : offline
                ? 'offline'
                : collabUnavailable
                  ? 'unavailable'
                  : 'alone',
  );

  // Dismissal is forgotten once `reason` changes, including collapsing to 'hidden' when wantShow goes false, so a recurring tier re-shows.
  let dismissed = $state(false);
  $effect(() => {
    reason;
    dismissed = false;
  });
  const show = $derived(wantShow && !dismissed);

  const waitingSinceLabel = $derived(
    waitingSince === null
      ? ''
      : new Date(waitingSince).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  );

  // base.css's reduced-motion reset only catches CSS animations/transitions, not Svelte's JS ones.
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fades opacity over the first 60% (not `slide`'s last 5%) so the strip is invisible before it's squashed short enough for the border-radius to look wrong.
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

<!-- One escalating strip; tiers map onto docs/contract.md §4's state table (gated/reaching/departing/unreachable/offline/collabUnavailable/alone). -->
{#if show}
  <div
    class="sync-banner"
    class:soft={!strong}
    role="status"
    aria-live="polite"
    in:slide={{ duration: reducedMotion ? 0 : 150 }}
    out:bannerOut={{ duration: reducedMotion ? 0 : 220 }}
  >
    <span class="ic" class:dot={gated} aria-hidden="true">
      {#if gated}
        <!-- Calm dot, not a spinner: a spinner promises imminence and lies after 30 seconds (§4.2). -->
        <span class="waiting-dot"></span>
      {:else}
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      {/if}
    </span>
    {#if gated}
      <span class="msg">
        <strong>You're the only one here.</strong>
        {#if waitingSinceLabel}Waiting since {waitingSinceLabel}.{/if}
        {#if isP2P}
          Copad opens the document when someone joins. Until then you can read,
          copy and export it, but not write. In peer-to-peer mode nothing you write
          leaves this device until it's received, so writing alone here would just
          be lost.
        {:else}
          The server confirms it: Copad opens the document the instant someone
          joins. Until then you can read, copy and export it, but not write.
        {/if}
      </span>
      <span class="actions">
        {#if onCopyInviteLink}
          <button class="invite-cta" onclick={onCopyInviteLink}>Copy invite link</button>
        {/if}
        <button class="link" onclick={onConnectStorage}>Connect storage</button>
        {#if onExport}
          <button class="link" onclick={onExport}>Export a copy</button>
        {/if}
        {#if isP2P && onWriteSolo}
          <button
            class="link write-solo"
            onclick={onWriteSolo}
            title="Nothing you write will leave this device until someone joins."
          >
            Write alone anyway
          </button>
        {/if}
      </span>
    {:else if reaching}
      <span class="msg">
        <strong>Someone's here,</strong> still connecting to them.
      </span>
      <span class="actions">
        {#if onRetry}
          <button class="link" onclick={onRetry}>Retry</button>
        {/if}
        {#if onConnectionDetails}
          <button class="link" onclick={onConnectionDetails}>Connection details</button>
        {/if}
      </span>
    {:else if departing}
      <span class="msg">
        <strong>{departedPeerName ?? 'Someone'} left.</strong>
        You can keep writing for a moment.
      </span>
    {:else if unreachableNet}
      <span class="msg">
        We can't tell whether anyone else is here, so the document stays open.
      </span>
    {:else if offline}
      <span class="msg">
        <strong>You're offline.</strong>
        The document stays open; nothing syncs until you're back.
      </span>
    {:else if collabUnavailable}
      <span class="msg">
        {#if saved}
          <strong>Real-time sync isn't available on this site.</strong>
          Kept for you in {storageLabel}, collaborators won't see live edits, but your
          own copy is safe.
        {:else}
          <strong>Real-time sync isn't available on this site.</strong>
          Your notes stay on this device only.
        {/if}
      </span>
      {#if !saved}
        <span class="actions">
          <button class="link" onclick={onConnectStorage}>Connect storage</button>
        </span>
      {/if}
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
        Kept for you in {storageLabel}, but a copy only you can open. No one sees your
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
    <button
      class="dismiss ghost"
      onclick={() => (dismissed = true)}
      aria-label="Dismiss"
      title="Dismiss"
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
    </button>
  </div>
{/if}

<style>
  .sync-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    padding: var(--sp-2) var(--sp-4);
    /* Own margin, not the parent's flex gap: `slide` animates margin alongside height, so removal shrinks smoothly instead of snapping shut. */
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
  /* >=44px hit area (WCAG 2.5.5): grown via padding, not icon size. */
  .dismiss {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    margin: calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) 0;
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
