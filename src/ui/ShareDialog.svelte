<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { Toasts } from './toasts.svelte.js';
  import type { RoomId } from '../collaboration/types.js';
  import {
    getLinkKey,
    rememberedRoomPassword,
    setRoomPassword,
    setLinkKey,
    generateRoomKey,
  } from '../collaboration/roomKey.js';

  let {
    open,
    onclose,
    room,
    toasts,
    envPassword,
    onSecurityChange,
  }: {
    open: boolean;
    onclose: () => void;
    room: RoomId;
    toasts: Toasts;
    envPassword?: string;
    /** Called after the room's encryption changes, so the Editor can reconnect. */
    onSecurityChange?: () => void;
  } = $props();

  let inputEl = $state<HTMLInputElement | undefined>();

  // Local mirror of the room's current encryption, re-read whenever the dialog
  // opens (location.hash / localStorage aren't reactive on their own).
  let linkKey = $state<string | undefined>(undefined);
  let storedPw = $state('');
  let pwInput = $state('');

  $effect(() => {
    if (open) {
      linkKey = getLinkKey(location);
      storedPw = rememberedRoomPassword(room) ?? '';
      pwInput = storedPw;
    }
  });

  const base = $derived(`${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`);
  const url = $derived(linkKey ? `${base}#k=${encodeURIComponent(linkKey)}` : base);
  const encrypted = $derived(!!linkKey || !!storedPw || !!envPassword);
  const envOnly = $derived(!linkKey && !storedPw && !!envPassword);

  function makeSecureLink(): void {
    const key = generateRoomKey();
    setLinkKey(key, location, history);
    setRoomPassword(room, null);
    linkKey = key;
    storedPw = '';
    pwInput = '';
    onSecurityChange?.();
    toasts.success('Secure link created — anyone with the link can read this room');
  }

  function applyPassword(): void {
    const pw = pwInput.trim();
    setRoomPassword(room, pw || null);
    setLinkKey(null, location, history);
    linkKey = undefined;
    storedPw = pw;
    onSecurityChange?.();
    toasts.success(pw ? 'Room password applied' : 'Room password removed');
  }

  function removeEncryption(): void {
    setLinkKey(null, location, history);
    setRoomPassword(room, null);
    linkKey = undefined;
    storedPw = '';
    pwInput = '';
    onSecurityChange?.();
    toasts.info('Encryption removed from this room');
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      toasts.success('Invite link copied to clipboard');
      onclose();
      return;
    } catch {
      /* fall through to the manual fallback */
    }
    // Fallback for non-secure contexts / denied clipboard permission.
    inputEl?.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    if (ok) {
      toasts.success('Invite link copied');
      onclose();
    } else {
      toasts.info('Press ⌘/Ctrl+C to copy the selected link');
    }
  }
</script>

<Dialog {open} {onclose} title="Share this document">
  <p class="share-hint">
    Anyone with this link joins and edits in real time — peer-to-peer, no account needed.
    {#if linkKey}
      <strong>This link carries the room's encryption key</strong>, so keep it private.
    {/if}
  </p>
  <div class="share-row">
    <input
      bind:this={inputEl}
      type="text"
      readonly
      value={url}
      aria-label="Invite link"
      onfocus={(e) => e.currentTarget.select()}
    />
    <button class="primary" onclick={copy}>Copy link</button>
  </div>
  <p class="share-room">
    Document: <code>{room}</code>
  </p>

  <section class="share-security">
    <h3>
      Room privacy
      {#if encrypted}<span class="lock" title="End-to-end encrypted">🔒 Encrypted</span>{/if}
    </h3>

    {#if envOnly}
      <p class="sec-note">This deployment encrypts every room with a shared key.</p>
    {/if}

    {#if linkKey}
      <p class="sec-note">
        <strong>Secure link.</strong> The key lives in the link's <code>#</code> fragment —
        it's never sent to the signaling server. Anyone with the link can read.
      </p>
      <div class="sec-actions">
        <button onclick={removeEncryption}>Remove encryption</button>
      </div>
    {:else}
      <p class="sec-note">
        Encrypt this room end-to-end. Either bake a key into the link, or set a password
        to share separately. (WebRTC transport only — the hub relay can't be E2E.)
      </p>
      <div class="sec-actions">
        <button class="primary" onclick={makeSecureLink}>Generate secure link</button>
      </div>
      <div class="sec-pw">
        <input
          type="text"
          placeholder="…or a room password"
          value={pwInput}
          oninput={(e) => (pwInput = e.currentTarget.value)}
          onkeydown={(e) => e.key === 'Enter' && applyPassword()}
          aria-label="Room password"
        />
        <button onclick={applyPassword} disabled={pwInput.trim() === storedPw}>
          {storedPw ? 'Update' : 'Set'}
        </button>
        {#if storedPw}<button onclick={removeEncryption}>Remove</button>{/if}
      </div>
      <small class="sec-help">
        Password-protected? Collaborators must enter the same password here to read.
        Not seeing edits? Double-check the password — a wrong one looks like an empty room.
      </small>
    {/if}
  </section>
</Dialog>

<style>
  .share-hint {
    margin: 0 0 var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .share-row {
    display: flex;
    gap: var(--sp-2);
  }
  .share-row input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  .share-row button {
    flex-shrink: 0;
  }
  .share-room {
    margin: var(--sp-4) 0 0;
    font-size: var(--fs-300);
    color: var(--text-faint);
  }
  .share-room code {
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .share-security {
    margin-top: var(--sp-4);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--border, var(--surface-3));
  }
  .share-security h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    margin: 0 0 var(--sp-2);
    font-size: var(--fs-400);
    font-weight: 600;
  }
  .share-security .lock {
    font-size: var(--fs-300);
    font-weight: 500;
    color: var(--ok, var(--accent));
  }
  .sec-note {
    margin: 0 0 var(--sp-3);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .sec-note code {
    font-family: var(--font-mono);
  }
  .sec-actions {
    display: flex;
    gap: var(--sp-2);
    margin-bottom: var(--sp-3);
  }
  .sec-pw {
    display: flex;
    gap: var(--sp-2);
  }
  .sec-pw input {
    flex: 1;
  }
  .sec-pw button {
    flex-shrink: 0;
  }
  .sec-help {
    display: block;
    margin-top: var(--sp-2);
    color: var(--text-faint);
    font-size: 0.75rem;
    line-height: 1.4;
  }
</style>
