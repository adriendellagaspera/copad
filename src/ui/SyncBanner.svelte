<script lang="ts">
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { ConnStatus, Transport } from '../collaboration/types.js';

  let {
    conn,
    transport,
    storageLabel,
    gated = false,
    gateEligible = false,
    collabUnavailable = false,
    onShare,
    onConnectStorage,
    onExport,
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
    /** True when this deployment can't do real-time collaboration at all (no
     *  signaling server, or mixed-content ws:// on https://) — a permanent
     *  environment fact, not a transient "no peer yet" state. Its own tier: never
     *  blocks (the write-gate already excludes it via `gateEligible`), never
     *  offers Invite (there's no one it could ever reach), and stays neutral in
     *  tone — a fact you can't act on right now isn't an urgent warning. */
    collabUnavailable?: boolean;
    /** Open the Share dialog so the user can invite a collaborator. */
    onShare: () => void;
    /** Open Settings so the user can connect a backend to keep their own copy. */
    onConnectStorage: () => void;
    /** Open the "Export a copy" dialog. */
    onExport?: () => void;
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
  // solo reminder once you've opted to write there. `collabUnavailable` is excluded
  // even though it can coincide with P2P + !saved — it's a permanent fact you can't
  // resolve right now, not an urgent, actionable warning, so it stays neutral.
  const strong = $derived(!collabUnavailable && isP2P && !saved);
  // One top strip, an escalation ladder: the gate (blocks, transient — someone
  // could still join) → collab-unavailable (never blocks, permanent environment
  // fact, its own tier) → the standing solo reminder (never blocks, transient —
  // you opted to write solo, or the room is saved / on a hub and was never
  // gateable). Nothing during the gate's grace window. Same slot throughout.
  const wantShow = $derived(gated || collabUnavailable || (alone && !gateEligible));

  // Dismissible: the write-gate itself lives on the editor (click/keystroke
  // lifts it regardless of this banner), so hiding the strip never traps you —
  // it only drops the explanation + Invite/Connect nudge until the *reason*
  // changes. `reason` collapses to 'hidden' whenever `wantShow` is false, so a
  // dismissal is forgotten the moment there's a fresh thing to say (a new tier,
  // or the same tier recurring after going away).
  const reason = $derived(
    !wantShow ? 'hidden' : gated ? 'gated' : collabUnavailable ? 'unavailable' : 'alone',
  );
  let dismissed = $state(false);
  $effect(() => {
    reason;
    dismissed = false;
  });
  const show = $derived(wantShow && !dismissed);

  // Svelte's JS transitions aren't touched by the CSS reduced-motion reset in
  // base.css (that only catches CSS animations/transitions), so they need
  // their own check.
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Plain `slide` fades opacity in only over the last 5% of the animation, so
  // for most of the exit the rounded, bordered strip is fully visible while its
  // own height/padding/margin/border shrink toward 0 — a squashed pill by the
  // end, worst right where the border-radius no longer fits the box. Fading
  // out over the *first* 60% instead means the strip is already invisible well
  // before it gets short enough for the rounding to look wrong; the last 40%
  // just closes the now-invisible gap it leaves behind.
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

<!-- Presence-first solo state, one strip that escalates (north-star: voice + paper;
     the interface recedes in front of the text — never a scrim over it). Tiers:
       • gated → the write-gate: editor read-only, "start writing to write solo".
       • collabUnavailable → this deployment can't sync across devices at all;
         connecting storage is the only durability story here.
       • alone → a standing reminder, calibrated to where edits go (P2P live-only /
         P2P saved / hub), once you've opted to write on your own.
     It never implies an absent peer will see live edits before they join. -->
{#if show}
  <div
    class="sync-banner"
    class:soft={!strong}
    role="status"
    aria-live="polite"
    in:slide={{ duration: reducedMotion ? 0 : 150 }}
    out:bannerOut={{ duration: reducedMotion ? 0 : 220 }}
  >
    <span class="ic" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </span>
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
        {#if onExport}
          <button class="link" onclick={onExport}>Export a copy</button>
        {/if}
      </span>
    {:else if collabUnavailable}
      <span class="msg">
        {#if saved}
          <strong>Real-time sync isn't available on this site.</strong>
          Kept for you in {storageLabel} — collaborators won't see live edits, but your
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
    <button
      class="dismiss ghost"
      onclick={() => (dismissed = true)}
      aria-label="Dismiss"
      title="Dismiss"
    >
      ✕
    </button>
  </div>
{/if}

<style>
  /* Restraint over a coloured-alert flood: the strip is a faintly amber-tinted
     surface, not a saturated warning field. The tone is carried by one small cue —
     the amber icon — rather than by dyeing the whole bar, so it reads as a calm
     heads-up that recedes in front of the text (north-star), not a Bootstrap alert. */
  .sync-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    padding: var(--sp-2) var(--sp-4);
    /* Own margin, not the parent's flex `gap`: `slide` (see App.svelte's `.app`
       comment) animates a node's margin alongside its height, so the trailing
       gap shrinks away smoothly instead of snapping shut the instant this node
       is removed at the end of the dismiss/disappear transition. */
    margin-bottom: var(--sp-4);
    background: color-mix(in srgb, var(--warn-soft) 55%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--warn-border) 55%, var(--border));
    border-radius: var(--r-md);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.4;
  }
  /* No mobile margin-top here to clear the floating room-name pill: that
     clearance is .app's own top padding instead (app.css), so this banner
     — whether or not it's the first flow child — never has to guess. A
     margin here previously stacked wrongly on top of that same padding. */
  /* Informational tiers (a saved copy, or a relaying hub) aren't "into the void" —
     drop the amber tint entirely for a plain neutral surface and a neutral icon. */
  .sync-banner.soft {
    background: var(--surface-2);
    border-color: var(--border);
  }
  .ic {
    flex-shrink: 0;
    display: inline-flex;
    color: var(--warn);
  }
  .sync-banner.soft .ic {
    color: var(--text-muted);
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
    gap: var(--sp-2);
    flex-shrink: 0;
  }
  /* >=44px hit area (WCAG 2.5.5) around a small glyph — grown via padding, not
     by enlarging the ✕ itself. Always last, after any tier's own actions. */
  .dismiss {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    margin: calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) 0;
    font-size: 0.75rem;
    color: var(--text-faint);
    border: none;
  }
  .dismiss:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }
  /* Primary — a filled accent chip. It pops without clashing now the field is only
     faintly tinted (the old saturated-yellow field made accent-blue collide). */
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
  /* Secondary — a real ghost button (transparent + border), so "Connect storage"
     reads as the alternative button it is, not a floating underlined link. Overrides
     the global inline `button.link` look within the banner only. */
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
