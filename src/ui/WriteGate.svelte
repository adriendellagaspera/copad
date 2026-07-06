<script lang="ts">
  // Write-gate, shown as a bottom sheet while the room is peer-to-peer, live-only
  // for you, and you're alone (no peers). In that state nothing you write leaves
  // this device until someone joins — writing solo would be "talking to an empty
  // room", which isn't what Copad is for. So the editor goes read-only and this
  // explains why, with Invite as the obvious next step.
  //
  // North-star note: this used to be a centered card over a blurred full-screen
  // scrim — chrome fighting the text for attention. A sheet anchored to the bottom
  // edge keeps the (empty, read-only) page fully visible above it, in keeping with
  // "the interface recedes in front of the text": the gate explains itself without
  // dimming or covering the thing it's talking about.
  //
  // It is *not* a wall: `onWriteSolo` lets a determined user (or someone just
  // exploring) write on their own anyway — for this session only, so a reload
  // re-asserts the gate. It also lifts on its own the moment a peer joins, or once
  // you connect storage (then the room is Saved, not live-only, and this never shows).
  import { slide } from 'svelte/transition';

  let {
    offline = false,
    onShare,
    onConnectStorage,
    onWriteSolo,
  }: {
    /** True when the browser is offline: edits aren't reaching anyone because the
     *  network is down, not merely because you're alone. Adapts the copy. */
    offline?: boolean;
    /** Open the Share dialog to invite a collaborator (primary action). */
    onShare: () => void;
    /** Open Settings to connect a backend (makes the room Saved → gate lifts). */
    onConnectStorage: () => void;
    /** Write solo in this room anyway, for this session (a reload re-asserts the gate). */
    onWriteSolo: () => void;
  } = $props();
</script>

<div
  class="gate"
  role="region"
  aria-label="Waiting for someone to join"
  transition:slide={{ duration: 180 }}
>
  {#if offline}
    <p class="gate-text">
      <strong>You're offline.</strong>
      Nothing you write leaves this device until you're back and someone joins.
    </p>
  {:else}
    <p class="gate-text">
      <strong>Copad is for writing together.</strong>
      You're the only one here — nothing you write leaves this device until someone joins.
    </p>
  {/if}

  <div class="gate-actions">
    <button class="primary" type="button" onclick={onShare}>Invite someone</button>
    <button type="button" onclick={onConnectStorage}>Connect storage</button>
    <button class="gate-skip" type="button" onclick={onWriteSolo}>Write on your own</button>
  </div>
</div>

<style>
  /* Anchored to the bottom edge, not a full-screen scrim: the (empty) editor above
     stays completely visible and uncovered — the gate is a strip that explains
     itself, not a wall that hides the page behind it. */
  .gate {
    position: absolute;
    inset: auto 0 0 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    background: var(--surface);
    border-top: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
  }
  .gate-text {
    flex: 1 1 16rem;
    margin: 0;
    color: var(--text);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .gate-text strong {
    display: block;
  }
  .gate-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
  .gate-skip {
    background: none;
    border: none;
    padding: var(--sp-1) var(--sp-2);
    color: var(--text-muted);
    font-size: var(--fs-300);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .gate-skip:hover:not(:disabled) {
    color: var(--text);
    background: none;
  }
</style>
