<script lang="ts">
  import { tick } from 'svelte';
  import Dialog from './Dialog.svelte';
  import type { Toasts } from './toasts.svelte.js';
  import type { RoomId } from '../collaboration/types.js';
  import { Transport } from '../collaboration/types.js';
  import { roomPassword, setRoomPassword, clearRoomPassword, type RoomCredential } from '../collaboration/roomAccess.js';
  import { parseRoomCredential } from '../collaboration/parse.js';
  import { currentSecretKey, clearSecretKey, rotateSecretKey } from '../collaboration/secretLink.js';
  import { rememberRoomEncryption, forgetRoomEncryption } from '../collaboration/roomLock.js';
  import { migrateRoomCache } from '../collaboration/cache.js';
  import { copyText } from './clipboard.js';
  import type { Milliseconds } from '../time.js';
  import {
    CopyFeedback,
    INVITE_ROLE_CHOICES,
    InviteRole,
    LinkExposure,
    RoomSecurityKind,
    SHARE_TITLE,
    SecurityChange,
    ShareView,
    emailShareUrl,
    isEncrypted,
    linkExposureAfterChange,
    roomSecurity,
    shareMessage,
    shareUrl,
    smsShareUrl,
    whatsappShareUrl,
    type AppUrl,
    type ShareUrl,
  } from './shareLinks.js';

  let {
    open,
    onclose,
    room,
    toasts,
    transport,
    envPassword,
    saved = false,
    storageLabel,
    onSecurityChange,
  }: {
    open: boolean;
    onclose: () => void;
    room: RoomId;
    toasts: Toasts;
    transport: Transport;
    envPassword?: string;
    saved?: boolean;
    storageLabel?: string;
    onSecurityChange?: () => void;
  } = $props();

  const CONFIRM_FLASH_MS = 4_000 as Milliseconds;
  const REMOVE_CONFIRM_MS = 4_000 as Milliseconds;
  const COPIED_FLASH_MS = 2_000 as Milliseconds;

  let linkInputEl = $state<HTMLInputElement | undefined>();
  let securityEl = $state<HTMLElement | undefined>();
  let securityTriggerEl = $state<HTMLButtonElement | undefined>();

  // Re-read on open: location.hash / localStorage aren't reactive on their own.
  let linkKey = $state<RoomCredential | null>(null);
  let storedPw = $state<RoomCredential | null>(null);
  let pwInput = $state('');
  let view = $state<ShareView>(ShareView.Invite);
  let role = $state<InviteRole>(InviteRole.Editor);
  let exposure = $state<LinkExposure>(LinkExposure.Unshared);
  let copyFeedback = $state<CopyFeedback>(CopyFeedback.Idle);

  $effect(() => {
    if (open) {
      linkKey = currentSecretKey();
      storedPw = roomPassword().credential(room);
      pwInput = storedPw ?? '';
      view = ShareView.Invite;
      role = InviteRole.Editor;
      exposure = LinkExposure.Unshared;
      copyFeedback = CopyFeedback.Idle;
      clearRemoveConfirm();
      clearConfirm();
    }
  });

  $effect(() => () => {
    clearTimeout(confirmRemoveTimer);
    clearTimeout(confirmTimer);
    clearTimeout(copiedTimer);
  });

  const appUrl = $derived(`${location.origin}${location.pathname}` as AppUrl);
  const url = $derived(shareUrl(appUrl, room, role, linkKey));
  const security = $derived(
    roomSecurity({
      transport,
      linkKey,
      storedPassword: storedPw,
      envPassword: parseRoomCredential(envPassword ?? null),
    }),
  );

  const currentKey = (): RoomCredential | null => linkKey ?? storedPw;

  function noteLinkChanged(before: ShareUrl): void {
    exposure = linkExposureAfterChange(exposure, before, url);
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
    flashConfirm(SecurityChange.SecureLink);
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
    flashConfirm(pw ? SecurityChange.PasswordSet : SecurityChange.PasswordCleared);
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
    flashConfirm(SecurityChange.EncryptionRemoved);
  }

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
    confirmRemoveTimer = setTimeout(() => (confirmingRemove = false), REMOVE_CONFIRM_MS);
  }

  // Inline, not a toast: on mobile a fixed toast would sit under the dialog's own sheet.
  let confirmed = $state<SecurityChange | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  function clearConfirm(): void {
    clearTimeout(confirmTimer);
    confirmed = null;
  }

  function flashConfirm(change: SecurityChange): void {
    clearTimeout(confirmTimer);
    confirmed = change;
    confirmTimer = setTimeout(() => (confirmed = null), CONFIRM_FLASH_MS);
  }

  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const COPY_TOAST_GROUP = 'share-dialog-copy';

  async function copy(): Promise<void> {
    const label = role === InviteRole.Reader ? 'View-only link copied to clipboard' : 'Invite link copied to clipboard';
    clearTimeout(copiedTimer);
    if (await copyText(url)) {
      toasts.success(label, undefined, COPY_TOAST_GROUP);
      copyFeedback = CopyFeedback.Copied;
      exposure = LinkExposure.Shared;
      copiedTimer = setTimeout(() => (copyFeedback = CopyFeedback.Idle), COPIED_FLASH_MS);
    } else {
      linkInputEl?.select();
      copyFeedback = CopyFeedback.Manual;
      exposure = LinkExposure.Shared;
      toasts.info('Press ⌘/Ctrl+C to copy the selected link', undefined, COPY_TOAST_GROUP);
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const message = $derived(shareMessage(url));

  async function share(): Promise<void> {
    exposure = LinkExposure.Shared;
    try {
      await navigator.share({ title: SHARE_TITLE, url });
    } catch {
      /* navigator.share() rejects on cancel */
    }
  }

  function shareViaWhatsapp(): void {
    exposure = LinkExposure.Shared;
    window.open(whatsappShareUrl(message), '_blank', 'noopener');
  }

  function shareViaSms(): void {
    exposure = LinkExposure.Shared;
    location.href = smsShareUrl(message);
  }

  function shareViaEmail(): void {
    exposure = LinkExposure.Shared;
    location.href = emailShareUrl(message);
  }

  async function goTo(next: ShareView): Promise<void> {
    view = next;
    clearRemoveConfirm();
    clearConfirm();
    await tick();
    if (next === ShareView.Security) securityEl?.focus();
    else securityTriggerEl?.focus();
  }

  function setRole(next: InviteRole): void {
    role = next;
    copyFeedback = CopyFeedback.Idle;
  }
</script>

<Dialog {open} {onclose} title={view === ShareView.Security ? 'Document security' : 'Share this document'}>
  {#if view === ShareView.Invite}
    <p class="share-hint">
      Anyone with this link joins and edits in real time{transport === Transport.P2P
        ? ': peer-to-peer, no account needed.'
        : ', through this deployment\u2019s relay server. No account needed.'}
    </p>

    <div class="role-row">
      <div class="role-select" role="group" aria-label="What the invite link opens">
        {#each INVITE_ROLE_CHOICES as choice (choice.role)}
          <button
            type="button"
            class="role-option"
            aria-pressed={role === choice.role}
            onclick={() => setRole(choice.role)}
          >
            {choice.label}
          </button>
        {/each}
      </div>
      {#if isEncrypted(security)}
        <span class="key-badge" title="This link includes the encryption key">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 3l3 3M13 6l3 3" /></svg>
          Key included
        </span>
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
      <button class="primary" onclick={copy}>
        {#if copyFeedback === CopyFeedback.Copied}
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg>
          Copied
        {:else}
          Copy link
        {/if}
      </button>
      {#if canShare}
        <button onclick={share} aria-label="Share invite link">📤 Share</button>
      {:else}
        <div class="share-fallbacks" role="group" aria-label="Share via">
          <button onclick={shareViaWhatsapp} aria-label="Share via WhatsApp" title="WhatsApp">💬</button>
          <button onclick={shareViaSms} aria-label="Share via SMS" title="SMS">📱</button>
          <button onclick={shareViaEmail} aria-label="Share via email" title="Email">✉️</button>
        </div>
      {/if}
    </div>

    <p class="share-status" role="status">
      {#if exposure === LinkExposure.Stale}
        <span class="warn">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4M12 17.2v.1" /></svg>
          This link changed when you changed the document's security. Send the new one: the copy you shared no longer opens the document.
        </span>
      {:else if copyFeedback === CopyFeedback.Manual}
        <span class="warn">The link is selected. Copy it with your keyboard or a long-press.</span>
      {/if}
    </p>

    {#if role === InviteRole.Reader}
      <p class="role-caveat">
        View-only disables editing in the recipient's UI. It is <strong>not enforced</strong>: anyone
        can remove <code>role=reader</code> from the URL and edit. Use it to signal intent among
        people you already trust, never to keep someone out.
      </p>
    {:else if isEncrypted(security)}
      <p class="role-caveat">
        <strong>This link carries the document's encryption key</strong>: anyone who gets it can read
        the document, so send it the way you'd send a password.
      </p>
    {/if}

    <p class="persist-note" class:is-saved={saved}>
      <span class="persist-icon" aria-hidden="true">
        {#if saved}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 1.5 8.7" /><path d="M9 14.5l2 2 4-4" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
        {/if}
      </span>
      {#if saved}
        Saved to <strong>your {storageLabel ?? 'storage'}</strong>. Collaborators edit live but
        can’t write to your storage; anyone who connects their own backend keeps their own saved copy.
      {:else}
        This document isn’t saved to any storage of yours: it lives in the live session and each
        device’s local cache only. Connect a backend to save it to your own storage.
      {/if}
    </p>

    <div class="security-summary">
      <p class="security-state">
        {#if isEncrypted(security)}
          <span class="lock">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
            Encrypted
          </span>
          {#if security.kind === RoomSecurityKind.SecretLink}
            The key travels in the link above.
          {:else if security.kind === RoomSecurityKind.Password}
            Collaborators need the document password.
          {:else}
            This deployment's shared key protects every document.
          {/if}
        {:else if security.kind === RoomSecurityKind.Relayed}
          <strong>Not encrypted</strong>: this deployment relays every document through its
          server, which sees the text.
        {:else}
          <strong>Not encrypted</strong>: anyone who has the link can read this document.
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
        <button class="ghost back-btn" onclick={() => goTo(ShareView.Invite)}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
          Back to invite
        </button>
        {#if isEncrypted(security)}
          <span class="lock" title="End-to-end encrypted">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
            Encrypted
          </span>
        {/if}
      </div>

      <h3 id="share-security-title" class="visually-hidden">Document security</h3>

      <p class="sec-confirm" role="status" class:is-empty={!confirmed}>
        {#if confirmed}
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg>
          {#if confirmed === SecurityChange.SecureLink}
            Secure link created. Anyone with the link can read this document
          {:else if confirmed === SecurityChange.PasswordSet}
            Document password applied
          {:else if confirmed === SecurityChange.PasswordCleared}
            Document password removed
          {:else}
            Encryption removed from this document
          {/if}
        {/if}
      </p>

      {#if security.kind === RoomSecurityKind.Relayed}
        <p class="sec-note">
          <strong>This deployment can't encrypt documents.</strong> It syncs through a relay server,
          which is in the data path and sees the text. There is no key to add: end-to-end encryption
          needs the peer-to-peer transport.
        </p>
      {:else if security.kind === RoomSecurityKind.SecretLink}
        <p class="sec-note">
          <strong>Secure link.</strong> Anyone with the full link can read this document: the key
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
            This deployment encrypts every document with one shared key. Add a key of your own, a
            secure link or a password, so only the people you send it to can read <em>this</em> one.
          {:else if security.kind === RoomSecurityKind.Password}
            <strong>Document password.</strong> Collaborators must type the same password to read
            this document: send it separately from the link.
          {:else}
            Encrypt this document end-to-end: only people with the link or the password can read it.
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
          Not seeing edits in a protected document? Double-check the password: a wrong one looks
          like an empty document.
        </small>
      {/if}

      {#if security.kind !== RoomSecurityKind.Relayed}
      <details class="sec-details">
        <summary>How this works</summary>
        The key lives in the link's <code>#</code> fragment (or, for a password, on each device):
        browsers never send it to the signaling server, and both peers derive the same cipher
        locally. It protects the peer-to-peer (WebRTC) transport only: a WebSocket hub relay can't
        be end-to-end encrypted.
      </details>
      {/if}
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
    flex-wrap: wrap;
  }
  .share-row input {
    flex: 1 1 200px;
    min-width: 0;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
    /* iOS Safari auto-zooms on focused inputs under 16px font-size. */
    font-size: var(--fs-400);
  }
  .share-row button {
    flex-shrink: 0;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
  }
  .share-row button svg {
    display: block;
    flex-shrink: 0;
  }
  .share-fallbacks {
    display: flex;
    gap: var(--sp-1, 0.25rem);
    flex-shrink: 0;
  }
  .share-fallbacks button {
    padding: 0.4rem 0.55rem;
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
  .share-status .warn svg {
    vertical-align: -0.15em;
    flex-shrink: 0;
  }
  .key-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-sm);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--fs-300);
    font-weight: 500;
    white-space: nowrap;
  }
  .key-badge svg {
    display: block;
    flex-shrink: 0;
  }
  .persist-note {
    display: flex;
    gap: var(--sp-2);
    margin: var(--sp-3) 0 0;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-sm);
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
  .persist-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    margin-top: 0.2em;
  }
  .persist-icon svg {
    display: block;
  }
  .security-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    flex-wrap: wrap;
    margin-top: var(--sp-4);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--border);
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
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
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
  .back-btn svg {
    display: block;
    flex-shrink: 0;
  }
  .lock {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: var(--fs-300);
    font-weight: 500;
    color: var(--ok);
  }
  .lock svg {
    display: block;
    flex-shrink: 0;
  }
  .security-state .lock {
    font-weight: 600;
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
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin: 0 0 var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-sm);
    background: var(--ok-soft);
    color: var(--ok);
    font-size: var(--fs-300);
    font-weight: 500;
  }
  .sec-confirm svg {
    flex-shrink: 0;
    display: block;
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
    color: var(--text-muted);
  }
</style>
