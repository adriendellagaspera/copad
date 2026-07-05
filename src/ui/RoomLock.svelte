<script lang="ts">
  import type { RoomId } from '../collaboration/types.js';
  import type { LockReason } from '../collaboration/roomLock.js';

  let {
    room,
    reason,
    onUnlock,
  }: {
    room: RoomId;
    /** Why the room is locked: no key supplied, or the wrong one. */
    reason?: LockReason;
    /** Try a key; resolves true when it unlocks the room, false when it's wrong. */
    onUnlock: (key: string) => Promise<boolean>;
  } = $props();

  let value = $state('');
  let busy = $state(false);
  // Set after a rejected attempt so we can show "that key doesn't match" without
  // conflating it with the initial `reason === 'wrong'` (a key already in the URL).
  let rejected = $state(false);

  async function submit(): Promise<void> {
    const key = value.trim();
    if (!key || busy) return;
    busy = true;
    rejected = false;
    const ok = await onUnlock(key);
    busy = false;
    if (!ok) rejected = true;
  }
</script>

<div class="lock" role="region" aria-label="Restricted room">
  <div class="lock-card">
    <div class="lock-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="11" width="16" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        <circle cx="12" cy="15.5" r="1.2" />
      </svg>
    </div>

    <h2>This document is encrypted</h2>
    <p class="lock-sub">
      <code>{room}</code> is protected with a room key. Enter the room password, or paste
      the key from its secure link, to unlock and decrypt it.
    </p>

    <form
      class="lock-form"
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        type="password"
        placeholder="Room key or password"
        aria-label="Room key or password"
        autocomplete="off"
        bind:value
        disabled={busy}
      />
      <button class="primary" type="submit" disabled={busy || !value.trim()}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
    </form>

    {#if rejected || reason === 'wrong'}
      <p class="lock-error" role="alert">
        That key doesn't match this room. Double-check the password or use the exact secure link.
      </p>
    {:else}
      <p class="lock-hint">
        Don't have it? Ask whoever shared this document for the password or the full secure link.
      </p>
    {/if}
  </div>
</div>

<style>
  .lock {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 40vh;
    padding: var(--sp-4);
  }
  .lock-card {
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
  }
  .lock-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }
  .lock-card h2 {
    margin: 0;
    font-size: var(--fs-500);
    font-weight: 600;
    color: var(--text);
  }
  .lock-sub {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.55;
  }
  .lock-sub code {
    font-family: var(--font-mono);
    color: var(--text);
  }
  .lock-form {
    display: flex;
    gap: var(--sp-2);
    width: 100%;
    margin-top: var(--sp-2);
  }
  .lock-form input {
    flex: 1;
    min-width: 0;
  }
  .lock-form button {
    flex-shrink: 0;
  }
  .lock-error {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .lock-hint {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
</style>
