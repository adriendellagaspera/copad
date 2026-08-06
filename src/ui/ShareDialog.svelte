<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { Toasts } from './toasts.svelte.js';
  import type { RoomId } from '../collaboration/types.js';
  import { roomPassword, setRoomPassword, clearRoomPassword, type RoomCredential } from '../collaboration/roomAccess.js';
  import { parseRoomCredential } from '../collaboration/parse.js';
  import { currentSecretKey, clearSecretKey, rotateSecretKey } from '../collaboration/secretLink.js';
  import { rememberRoomEncryption, forgetRoomEncryption } from '../collaboration/roomLock.js';
  import { migrateRoomCache } from '../collaboration/cache.js';
  import { copyText } from './clipboard.js';

  let {
    open,
    onclose,
    room,
    toasts,
    envPassword,
    saved = false,
    storageLabel,
    onSecurityChange,
  }: {
    open: boolean;
    onclose: () => void;
    room: RoomId;
    toasts: Toasts;
    envPassword?: string;
    /** Whether this room is saved to the local user's own storage backend. */
    saved?: boolean;
    /** Label of the backend saving it (only meaningful when `saved`). */
    storageLabel?: string;
    /** Called after the room's encryption changes, so the Editor can reconnect. */
    onSecurityChange?: () => void;
  } = $props();

  let inputEl = $state<HTMLInputElement | undefined>();
  let readerInputEl = $state<HTMLInputElement | undefined>();

  // Re-read on open: location.hash / localStorage aren't reactive on their own.
  let linkKey = $state<RoomCredential | undefined>(undefined);
  let storedPw = $state<RoomCredential | null>(null);
  let pwInput = $state('');

  $effect(() => {
    if (open) {
      linkKey = currentSecretKey() ?? undefined;
      storedPw = roomPassword().credential(room);
      pwInput = storedPw ?? '';
      confirmingRemove = false;
      copiedButton = null;
      secConfirm = null;
    }
  });

  const base = $derived(`${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`);
  // #k= must stay last so it's in the hash, not the query string.
  const hashSuffix = $derived(linkKey ? `#k=${encodeURIComponent(linkKey)}` : '');
  const url = $derived(`${base}${hashSuffix}`);
  const readerUrl = $derived(`${base}&role=reader${hashSuffix}`);
  const encrypted = $derived(!!linkKey || !!storedPw || !!envPassword);
  const envOnly = $derived(!linkKey && !storedPw && !!envPassword);

  const currentKey = (): RoomCredential | null => linkKey ?? storedPw ?? null;

  // Fingerprint + cache migration must both complete before onSecurityChange remounts the editor.
  async function makeSecureLink(): Promise<void> {
    const before = currentKey();
    const key = rotateSecretKey();
    clearRoomPassword(room); // link and password are mutually exclusive
    await rememberRoomEncryption(room, key);
    await migrateRoomCache(room, before, key);
    linkKey = key;
    storedPw = null;
    pwInput = '';
    onSecurityChange?.();
    flashSecConfirm('Secure link created — anyone with the link can read this document');
  }

  async function applyPassword(): Promise<void> {
    const before = currentKey();
    const pw = pwInput.trim();
    const cred = parseRoomCredential(pw); // accept user input into the domain via the canonical parser
    setRoomPassword(room, pw); // empty string clears the entry
    clearSecretKey();
    if (cred) await rememberRoomEncryption(room, cred);
    else forgetRoomEncryption(room);
    await migrateRoomCache(room, before, cred);
    linkKey = undefined;
    storedPw = cred;
    onSecurityChange?.();
    flashSecConfirm(pw ? 'Document password applied' : 'Document password removed');
  }

  async function removeEncryption(): Promise<void> {
    const before = currentKey();
    clearSecretKey();
    clearRoomPassword(room);
    forgetRoomEncryption(room);
    await migrateRoomCache(room, before, null);
    linkKey = undefined;
    storedPw = null;
    pwInput = '';
    confirmingRemove = false;
    onSecurityChange?.();
    flashSecConfirm('Encryption removed from this document');
  }

  // Two-click confirm: this breaks collaborators' current link/password.
  let confirmingRemove = $state(false);
  let confirmRemoveTimer: ReturnType<typeof setTimeout> | undefined;

  function requestRemoveEncryption(): void {
    if (confirmingRemove) {
      clearTimeout(confirmRemoveTimer);
      void removeEncryption();
      return;
    }
    confirmingRemove = true;
    confirmRemoveTimer = setTimeout(() => (confirmingRemove = false), 4000);
  }

  // Inline, not a toast: this dialog stays open after these actions, and on mobile a fixed toast would cover the sheet's own content.
  let secConfirm = $state<string | null>(null);
  let secConfirmTimer: ReturnType<typeof setTimeout> | undefined;

  function flashSecConfirm(text: string): void {
    clearTimeout(secConfirmTimer);
    secConfirm = text;
    secConfirmTimer = setTimeout(() => (secConfirm = null), 4000);
  }

  let copiedButton = $state<'invite' | 'reader' | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function flashCopied(which: 'invite' | 'reader'): void {
    clearTimeout(copiedTimer);
    copiedButton = which;
    copiedTimer = setTimeout(() => (copiedButton = null), 2000);
  }

  // One group so invite/reader copies swap in place instead of stacking.
  const COPY_TOAST_GROUP = 'share-dialog-copy';

  async function copyTo(
    text: string,
    el: HTMLInputElement | undefined,
    label: string,
    which: 'invite' | 'reader',
  ): Promise<void> {
    if (await copyText(text)) {
      toasts.success(label, undefined, COPY_TOAST_GROUP);
      flashCopied(which);
    } else {
      el?.select();
      toasts.info('Press ⌘/Ctrl+C to copy the selected link', undefined, COPY_TOAST_GROUP);
    }
  }

  const copy = () => copyTo(url, inputEl, 'Invite link copied to clipboard', 'invite');
  const copyReader = () => copyTo(readerUrl, readerInputEl, 'View-only link copied to clipboard', 'reader');
</script>

<Dialog {open} {onclose} title="Share this document">
  <p class="share-hint">
    Anyone with this link joins and edits in real time — peer-to-peer, no account needed.
    {#if linkKey}
      <strong>This link carries the document's encryption key</strong>, so keep it private.
    {/if}
  </p>

  <p class="persist-note" class:is-saved={saved}>
    {#if saved}
      💾 Saved to <strong>your {storageLabel ?? 'storage'}</strong>. Collaborators edit live but
      can’t write to your storage; anyone who connects their own backend keeps their own saved copy.
    {:else}
      ⚡ This document isn’t saved to any storage of yours — it lives in the live session and each
      device’s local cache only. Connect a backend to save it to your own storage.
    {/if}
  </p>

  <div class="share-row">
    {#if linkKey}
      <span class="key-badge" title="This link includes the encryption key">🔑 Key included</span>
    {/if}
    <input
      bind:this={inputEl}
      type="text"
      readonly
      value={url}
      aria-label="Invite link"
      onfocus={(e) => e.currentTarget.select()}
    />
    <button class="primary" onclick={copy}>{copiedButton === 'invite' ? 'Copied ✓' : 'Copy link'}</button>
  </div>

  <details class="reader-section">
    <summary>Share a view-only link</summary>
    <div class="reader-body">
      <div class="share-row">
        {#if linkKey}
          <span class="key-badge" title="This link includes the encryption key">🔑 Key included</span>
        {/if}
        <input
          bind:this={readerInputEl}
          type="text"
          readonly
          value={readerUrl}
          aria-label="View-only invite link"
          onfocus={(e) => e.currentTarget.select()}
        />
        <button onclick={copyReader}>{copiedButton === 'reader' ? 'Copied ✓' : 'Copy link'}</button>
      </div>
      <p class="reader-caveat">
        The view-only role disables editing in the UI, but is not technically enforced —
        a recipient could bypass it by removing <code>role=reader</code> from the URL.
        Use this for trusted collaborators you'd like to signal shouldn't edit.
      </p>
    </div>
  </details>

  <section class="share-security">
    <h3>
      Document privacy
      {#if encrypted}<span class="lock" title="End-to-end encrypted">🔒 Encrypted</span>{/if}
    </h3>

    {#if secConfirm}
      <p class="sec-confirm" role="status">✓ {secConfirm}</p>
    {/if}

    {#if envOnly}
      <p class="sec-note">This deployment encrypts every document with a shared key.</p>
    {/if}

    {#if linkKey}
      <div class="sec-note">
        <strong>Secure link.</strong> Anyone with the full link can read this document — the key
        travels inside the link itself, not through our servers.
        <details class="sec-details">
          <summary>How this works</summary>
          The key lives in the link's <code>#</code> fragment, which browsers never send to the
          signaling server.
        </details>
      </div>
      <div class="sec-actions">
        <button class:danger={confirmingRemove} onclick={requestRemoveEncryption}>
          {confirmingRemove ? 'Click again to confirm' : 'Remove encryption'}
        </button>
        {#if confirmingRemove}
          <span class="confirm-note">Collaborators' current link will stop working.</span>
        {/if}
      </div>
    {:else}
      <div class="sec-note">
        Encrypt this document end-to-end — only people with the link or password can read it.
        Either bake a key into the link, or set a password to share separately.
        <details class="sec-details">
          <summary>Limitations</summary>
          End-to-end encryption only applies over the peer-to-peer (WebRTC) transport — a
          WebSocket hub relay can't be end-to-end encrypted.
        </details>
      </div>
      <div class="sec-actions">
        <button class="primary" onclick={makeSecureLink}>Generate secure link</button>
      </div>
      <div class="sec-pw">
        <input
          type="text"
          placeholder="…or a document password"
          value={pwInput}
          oninput={(e) => (pwInput = e.currentTarget.value)}
          onkeydown={(e) => e.key === 'Enter' && applyPassword()}
          aria-label="Document password"
        />
        <button onclick={applyPassword} disabled={pwInput.trim() === (storedPw ?? '')}>
          {storedPw ? 'Update' : 'Set'}
        </button>
        {#if storedPw}
          <button class:danger={confirmingRemove} onclick={requestRemoveEncryption}>
            {confirmingRemove ? 'Confirm?' : 'Remove'}
          </button>
        {/if}
      </div>
      {#if confirmingRemove}
        <p class="confirm-note">Collaborators' current password will stop working.</p>
      {/if}
      <small class="sec-help">
        Password-protected? Collaborators must enter the same password here to read.
        Not seeing edits? Double-check the password — a wrong one looks like an empty document.
      </small>
    {/if}
  </section>

  <p class="share-room">
    Document: <code>{room}</code>
  </p>
</Dialog>

<style>
  .share-hint {
    margin: 0 0 var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .persist-note {
    margin: 0 0 var(--sp-4);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-2, 6px);
    background: var(--surface-3);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .persist-note.is-saved {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .persist-note strong {
    font-weight: 600;
  }
  .share-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .share-row input {
    flex: 1;
    font-family: var(--font-mono);
    /* Not a smaller size: this field select-alls on focus (see onfocus above),
       so any tap counts as a focus, and iOS Safari auto-zooms the page when a
       focused field's font-size is under 16px (see app.css's global input
       rule for the same fix). */
    font-size: var(--fs-400);
  }
  .share-row button {
    flex-shrink: 0;
  }
  .key-badge {
    flex-shrink: 0;
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-2, 6px);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--fs-300);
    font-weight: 500;
    white-space: nowrap;
  }
  .reader-section {
    margin-top: var(--sp-4);
  }
  .reader-section summary {
    cursor: pointer;
    font-size: var(--fs-300);
    color: var(--text-muted);
    user-select: none;
  }
  .reader-section summary:hover {
    color: var(--text);
  }
  .reader-body {
    margin-top: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .reader-caveat {
    margin: 0;
    font-size: var(--fs-300);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .reader-caveat code {
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
  .sec-confirm {
    margin: 0 0 var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-2, 6px);
    background: var(--ok-soft, var(--surface-3));
    color: var(--ok, var(--text));
    font-size: var(--fs-300);
    font-weight: 500;
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
  .sec-details {
    margin-top: var(--sp-2);
    color: var(--text-faint);
    font-size: 0.75rem;
    line-height: 1.4;
  }
  .sec-details summary {
    cursor: pointer;
    color: var(--text-faint);
    font-size: 0.75rem;
    user-select: none;
  }
  .sec-details summary:hover {
    color: var(--text-muted);
  }
  .sec-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin-bottom: var(--sp-3);
    flex-wrap: wrap;
  }
  .sec-actions button.danger,
  .sec-pw button.danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .confirm-note {
    margin: var(--sp-1) 0 var(--sp-3);
    color: var(--danger);
    font-size: 0.75rem;
    line-height: 1.4;
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
  .share-room {
    margin: var(--sp-4) 0 0;
    font-size: var(--fs-300);
    color: var(--text-faint);
  }
  .share-room code {
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
</style>
