<script lang="ts">
  // Write-gate overlay. Shown over the editor when the room is peer-to-peer,
  // live-only for you, and you're alone (no peers). In that state nothing you write
  // leaves this device until someone joins — writing solo would be "talking to an
  // empty room", which isn't what Copad is for. So the editor goes read-only and
  // this explains why, with Invite as the obvious next step.
  //
  // It is *not* a wall: `onWriteSolo` lets a determined user (or someone just
  // exploring) write on their own anyway — for this session only, so a reload
  // re-asserts the gate. It also lifts on its own the moment a peer joins, or once
  // you connect storage (then the room is Saved, not live-only, and this never shows).
  let {
    onShare,
    onConnectStorage,
    onWriteSolo,
  }: {
    /** Open the Share dialog to invite a collaborator (primary action). */
    onShare: () => void;
    /** Open Settings to connect a backend (makes the room Saved → gate lifts). */
    onConnectStorage: () => void;
    /** Write solo in this room anyway, for this session (a reload re-asserts the gate). */
    onWriteSolo: () => void;
  } = $props();
</script>

<div class="gate" role="region" aria-label="Waiting for someone to join">
  <div class="gate-card">
    <div class="gate-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    </div>

    <h2>Copad is for writing together</h2>
    <p class="gate-sub">
      You're the only one here. In peer-to-peer mode nothing you write leaves this
      device until someone joins — so there's no one to write to yet. Invite someone
      to start, or connect storage to keep your own copy.
    </p>

    <div class="gate-actions">
      <button class="primary" type="button" onclick={onShare}>Invite someone</button>
      <button type="button" onclick={onConnectStorage}>Connect storage</button>
    </div>

    <button class="gate-skip" type="button" onclick={onWriteSolo}>
      Just exploring? Write on your own
    </button>
  </div>
</div>

<style>
  /* Covers the editor it sits over (parent is position:relative). A translucent,
     lightly blurred scrim keeps the empty editor faintly visible behind, so it
     reads as "held back", not "gone". */
  .gate {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-4);
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    backdrop-filter: blur(2px);
  }
  .gate-card {
    width: 100%;
    max-width: 26rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--sp-3);
    padding: var(--sp-6) var(--sp-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg, 12px);
    box-shadow: var(--shadow-lg);
  }
  .gate-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-soft-text, var(--accent));
  }
  .gate-card h2 {
    margin: 0;
    font-size: var(--fs-500);
    font-weight: 600;
    color: var(--text);
  }
  .gate-sub {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.55;
  }
  .gate-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--sp-2);
    width: 100%;
    margin-top: var(--sp-2);
  }
  .gate-skip {
    margin-top: var(--sp-1);
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
