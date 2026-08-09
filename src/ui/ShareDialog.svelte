<script lang="ts">
  import { tick } from 'svelte';
  import Dialog from './Dialog.svelte';
  import type { Toasts } from './toasts.svelte.js';
  import type { RoomId } from '../collaboration/types.js';
  import { roomPassword, setRoomPassword, clearRoomPassword, type RoomCredential } from '../collaboration/roomAccess.js';
  import { parseRoomCredential } from '../collaboration/parse.js';
  import { currentSecretKey, clearSecretKey, rotateSecretKey } from '../collaboration/secretLink.js';
  import { rememberRoomEncryption, forgetRoomEncryption } from '../collaboration/roomLock.js';
  import { migrateRoomCache } from '../collaboration/cache.js';
  import { copyText } from './clipboard.js';
  import {
    InviteRole,
    RoomSecurityKind,
    ShareView,
    isEncrypted,
    roomSecurity,
    shareUrl,
    type AppUrl,
    type ShareUrl,
  } from './shareLinks.js';

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
    saved?: boolean;
    /** Label of the backend saving it (only meaningful when `saved`). */
    storageLabel?: string;
    /** Called after the room's encryption changes, so the Editor can reconnect. */
    onSecurityChange?: () => void;
  } = $props();

  let linkInputEl = $state<HTMLInputElement | undefined>();
  let securityEl = $state<HTMLElement | undefined>();
  let securityTriggerEl = $state<HTMLButtonElement | undefined>();

  // Re-read on open: location.hash / localStorage aren't reactive on their own.
  let linkKey = $state<RoomCredential | null>(null);
  let storedPw = $state<RoomCredential | null>(null);
  let pwInput = $state('');
  let view = $state<ShareView>(ShareView.Invite);
  let role = $state<InviteRole>(InviteRole.Editor);
  let shared = $state(false);
  let staleLink = $state(false);
  let copyFallback = $state(false);

  $effect(() => {
    if (open) {
      linkKey = currentSecretKey();
      storedPw = roomPassword().credential(room);
      pwInput = storedPw ?? '';
      view = ShareView.Invite;
      role = InviteRole.Editor;
      shared = false;
      staleLink = false;
      copyFallback = false;
      copied = false;
      clearRemoveConfirm();
      flashConfirm(null);
    }
  });

  $effect(() => () => {
    clearTimeout(confirmRemoveTimer);
    clearTimeout(secConfirmTimer);
    clearTimeout(copiedTimer);
  });

  const appUrl = $derived(`${location.origin}${location.pathname}` as AppUrl);
  const url = $derived(shareUrl(appUrl, room, role, linkKey));
  const security = $derived(
    roomSecurity({
      linkKey,
      storedPassword: storedPw,
      envPassword: parseRoomCredential(envPassword ?? null),
    }),
  );

  const currentKey = (): RoomCredential | null => linkKey ?? storedPw;

  function noteLinkChanged(before: ShareUrl): void {
    if (shared && before !== url) staleLink = true;
  }

  // Fingerprint + cache migration must both complete before onSecurityChange remounts the editor.
  async function makeSecureLink(): Promise<void> {
    const before = currentKey();
    const beforeUrl = url;
    const key = rotateSecretKey();
    clearRoomPassword(room); // link and password are mutually exclusive
    await rememberRoomEncryption(room, key);
    await migrateRoomCache(room, before, key);
    linkKey = key;
    storedPw = null;
    pwInput = '';
    noteLinkChanged(beforeUrl);
    onSecurityChange?.();
    flashConfirm('Secure link created — anyone with the link can read this document');
  }

  async function applyPassword(): Promise<void> {
    const before = currentKey();
    const beforeUrl = url;
    const pw = pwInput.trim();
    const cred = parseRoomCredential(pw);
    setRoomPassword(room, pw);
    clearSecretKey();
    if (cred) await rememberRoomEncryption(room, cred);
    else forgetRoomEncryption(room);
    await migrateRoomCache(room, before, cred);
    linkKey = null;
    storedPw = cred;
    noteLinkChanged(beforeUrl);
    onSecurityChange?.();
    flashConfirm(pw ? 'Document password applied' : 'Document password removed');
  }

  async function removeEncryption(): Promise<void> {
    const before = currentKey();
    const beforeUrl = url;
    clearSecretKey();
    clearRoomPassword(room);
    forgetRoomEncryption(room);
    await migrateRoomCache(room, before, null);
    linkKey = null;
    storedPw = null;
    pwInput = '';
    clearRemoveConfirm();
    noteLinkChanged(beforeUrl);
    onSecurityChange?.();
    flashConfirm('Encryption removed from this document');
  }

  // Two-click confirm: this breaks collaborators' current link/password.
  let confirmingRemove = $state(false);
  let confirmRemoveTimer: ReturnType<typeof setTimeout> | undefined;

  function clearRemoveConfirm(): void {
    clearTimeout(confirmRemoveTimer);
    confirmingRemove = false;
  }

  function requestRemoveEncryption(): void {
    if (confirmingRemove) {
      clearTimeout(confirmRemoveTimer);
      void removeEncryption();
      return;
    }
    confirmingRemove = true;
    confirmRemoveTimer = setTimeout(() => (confirmingRemove = false), 4000);
  }

  // Inline, not a toast: on mobile a fixed toast would sit under the dialog's own sheet.
  let secConfirm = $state<string | null>(null);
  let secConfirmTimer: ReturnType<typeof setTimeout> | undefined;

  function flashConfirm(text: string | null): void {
    clearTimeout(secConfirmTimer);
    secConfirm = text;
    if (text) secConfirmTimer = setTimeout(() => (secConfirm = null), 4000);
  }

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const COPY_TOAST_GROUP = 'share-dialog-copy';

  async function copy(): Promise<void> {
    const label = role === InviteRole.Reader ? 'View-only link copied to clipboard' : 'Invite link copied to clipboard';
    clearTimeout(copiedTimer);
    if (await copyText(url)) {
      toasts.success(label, undefined, COPY_TOAST_GROUP);
      copied = true;
      copyFallback = false;
      shared = true;
      staleLink = false;
      copiedTimer = setTimeout(() => (copied = false), 2000);
    } else {
      linkInputEl?.select();
      copied = false;
      copyFallback = true;
      shared = true;
      toasts.info('Press ⌘/Ctrl+C to copy the selected link', undefined, COPY_TOAST_GROUP);
    }
  }

  async function goTo(next: ShareView): Promise<void> {
    view = next;
    clearRemoveConfirm();
    flashConfirm(null);
    await tick();
    if (next === ShareView.Security) securityEl?.focus();
    else securityTriggerEl?.focus();
  }

  function setRole(next: InviteRole): void {
    role = next;
    copied = false;
    copyFallback = false;
  }

  const ROLES: { value: InviteRole; label: string }[] = [
    { value: InviteRole.Editor, label: 'Editing' },
    { value: InviteRole.Reader, label: 'View-only' },
  ];
</script>

<Dialog {open} {onclose} title={view === ShareView.Security ? 'Document security' : 'Share this document'}>
  {#if view === ShareView.Invite}
    <p class="share-hint">Anyone with this link joins and edits in real time — peer-to-peer, no account needed.</p>

    <div class="role-row">
      <div class="role-select" role="group" aria-label="What the invite link opens">
        {#each ROLES as opt (opt.value)}
          <button
            type="button"
            class="role-option"
            aria-pressed={role === opt.value}
            onclick={() => setRole(opt.value)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
      {#if linkKey}
        <span class="key-badge" title="This link includes the encryption key">🔑 Key included</span>
      {/if}
    </div>

    <div class="share-row">
      <input
        bind:this={linkInputEl}
        type="text"
        readonly
        value={url}
        aria-label={role === InviteRole.Reader ? 'View-only invite link' : 'Invite link'}
        onfocus={(e) => e.currentTarget.select()}
      />
      <button class="primary" onclick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
    </div>

    <p class="share-status" role="status">
      {#if staleLink}
        <span class="warn">⚠ This link changed when you changed the document's security — send the new one, the copy you shared no longer opens the document.</span>
      {:else if copyFallback}
        <span class="warn">The link is selected — copy it with your keyboard or a long-press.</span>
      {/if}
    </p>

    {#if role === InviteRole.Reader}
      <p class="role-caveat">
        View-only disables editing in the recipient's UI. It is <strong>not enforced</strong> — anyone
        can remove <code>role=reader</code> from the URL and edit. Use it to signal intent among
        people you already trust, never to keep someone out.
      </p>
    {:else if linkKey}
      <p class="role-caveat">
        <strong>This link carries the document's encryption key</strong> — anyone who gets it can read
        the document, so send it the way you'd send a password.
      </p>
    {/if}

    <p class="persist-note" class:is-saved={saved}>
      {#if saved}
        💾 Saved to <strong>your {storageLabel ?? 'storage'}</strong>. Collaborators edit live but
        can’t write to your storage; anyone who connects their own backend keeps their own saved copy.
      {:else}
        ⚡ This document isn’t saved to any storage of yours — it lives in the live session and each
        device’s local cache only. Connect a backend to save it to your own storage.
      {/if}
    </p>

    <div class="security-summary">
      <p class="security-state">
        {#if security.kind === RoomSecurityKind.SecretLink}
          🔒 <strong>Encrypted</strong> — the key travels in the link above.
        {:else if security.kind === RoomSecurityKind.Password}
          🔒 <strong>Encrypted</strong> — collaborators need the document password.
        {:else if security.kind === RoomSecurityKind.Deployment}
          🔒 <strong>Encrypted</strong> by this deployment's shared key.
        {:else}
          <strong>Not encrypted</strong> — anyone who has the link can read this document.
        {/if}
      </p>
      <button bind:this={securityTriggerEl} onclick={() => goTo(ShareView.Security)}>
        Document security
      </button>
    </div>

    <p class="share-room">Document: <code>{room}</code></p>
  {:else}
    <section class="security-view" bind:this={securityEl} tabindex="-1" aria-labelledby="share-security-title">
      <div class="security-head">
        <button class="ghost back-btn" onclick={() => goTo(ShareView.Invite)}>‹ Back to invite</button>
        {#if isEncrypted(security)}<span class="lock">🔒 Encrypted</span>{/if}
      </div>

      <h3 id="share-security-title" class="visually-hidden">Document security</h3>

      <p class="sec-confirm" role="status" class:is-empty={!secConfirm}>
        {#if secConfirm}✓ {secConfirm}{/if}
      </p>

      {#if security.kind === RoomSecurityKind.SecretLink}
        <p class="sec-note">
          <strong>Secure link.</strong> Anyone with the full link can read this document — the key
          travels inside the link itself, never through our servers.
        </p>
        <div class="sec-actions">
          <button class:danger={confirmingRemove} onclick={requestRemoveEncryption}>
            {confirmingRemove ? 'Click again to confirm' : 'Remove encryption'}
          </button>
          {#if confirmingRemove}
            <span class="confirm-note">Collaborators' current link will stop working.</span>
          {/if}
        </div>
      {:else}
        <p class="sec-note">
          {#if security.kind === RoomSecurityKind.Deployment}
            This deployment encrypts every document with one shared key. Add a key of your own — a
            secure link or a password — so only the people you send it to can read <em>this</em> one.
          {:else if security.kind === RoomSecurityKind.Password}
            <strong>Document password.</strong> Collaborators must type the same password to read
            this document — send it separately from the link.
          {:else}
            Encrypt this document end-to-end — only people with the link or the password can read it.
            Either bake a key into the link, or set a password to share separately.
          {/if}
        </p>
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
          Not seeing edits in a protected document? Double-check the password — a wrong one looks
          like an empty document.
        </small>
      {/if}

      <details class="sec-details">
        <summary>How this works</summary>
        The key lives in the link's <code>#</code> fragment (or, for a password, on each device) —
        browsers never send it to the signaling server, and both peers derive the same cipher
        locally. It protects the peer-to-peer (WebRTC) transport only: a WebSocket hub relay can't
        be end-to-end encrypted.
      </details>
    </section>
  {/if}
</Dialog>

<style>
  .share-hint {
    margin: 0 0 var(--sp-3);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .role-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    margin-bottom: var(--sp-2);
    flex-wrap: wrap;
  }
  /* Same segmented-control language as ThemeSelect / Settings' nav items. */
  .role-select {
    display: inline-flex;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-full);
    padding: 2px;
    gap: 2px;
  }
  .role-option {
    min-height: 44px;
    border: none;
    background: transparent;
    padding: 0 1rem;
    border-radius: var(--r-full);
    font: inherit;
    font-size: var(--fs-300);
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
  }
  .role-option:hover:not([aria-pressed='true']) {
    color: var(--text);
  }
  .role-option[aria-pressed='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .role-caveat {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-300);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .role-caveat code {
    font-family: var(--font-mono);
  }
  .share-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .share-row input {
    flex: 1;
    min-width: 0;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
    /* Not a smaller size: this field select-alls on focus (see onfocus above),
       so any tap counts as a focus, and iOS Safari auto-zooms the page when a
       focused field's font-size is under 16px (see app.css's global input
       rule for the same fix). */
    font-size: var(--fs-400);
  }
  .share-row button {
    flex-shrink: 0;
    min-height: 44px;
  }
  .share-status {
    margin: var(--sp-2) 0 0;
    font-size: var(--fs-300);
    line-height: 1.4;
    min-height: 1.25rem;
  }
  .share-status .warn {
    color: var(--warn-text);
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
  .persist-note {
    margin: var(--sp-3) 0 0;
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
  .security-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    flex-wrap: wrap;
    margin-top: var(--sp-4);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--border, var(--surface-3));
  }
  .security-state {
    flex: 1;
    min-width: 12rem;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.4;
  }
  .security-summary button {
    flex-shrink: 0;
    min-height: 44px;
  }
  .security-view {
    outline: none;
  }
  .security-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    margin-bottom: var(--sp-2);
  }
  .back-btn {
    min-height: 44px;
    padding-inline: var(--sp-2);
    margin-inline-start: calc(-1 * var(--sp-2));
    color: var(--text-muted);
    font-size: var(--fs-300);
    font-weight: 600;
  }
  .back-btn:hover {
    color: var(--text);
  }
  .lock {
    font-size: var(--fs-300);
    font-weight: 500;
    color: var(--ok, var(--accent));
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
  .sec-confirm.is-empty {
    display: none;
  }
  .sec-note {
    margin: 0 0 var(--sp-3);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .sec-details {
    margin-top: var(--sp-4);
    color: var(--text-faint);
    font-size: 0.75rem;
    line-height: 1.4;
  }
  .sec-details code {
    font-family: var(--font-mono);
  }
  .sec-details summary {
    cursor: pointer;
    color: var(--text-faint);
    font-size: 0.75rem;
    user-select: none;
    min-height: 44px;
    display: flex;
    align-items: center;
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
  .sec-actions button,
  .sec-pw button {
    min-height: 44px;
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
    min-width: 0;
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
  }
</style>
