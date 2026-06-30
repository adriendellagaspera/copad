<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { Toasts } from './toasts.svelte.js';
  import type { RoomId } from '../collaboration/types.js';
  import { roomPassword, setRoomPassword, clearRoomPassword, type RoomCredential } from '../collaboration/roomAccess.js';
  import { parseRoomCredential } from '../collaboration/parse.js';
  import { currentSecretKey, clearSecretKey, rotateSecretKey } from '../collaboration/secretLink.js';
  import { useI18n } from '../i18n/index.svelte.js';

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

  const i18n = useI18n();
  const t = $derived(i18n.t);

  let inputEl = $state<HTMLInputElement | undefined>();
  let readerInputEl = $state<HTMLInputElement | undefined>();

  // Local mirror of the room's current encryption, re-read whenever the dialog
  // opens (location.hash / localStorage aren't reactive on their own). linkKey and
  // storedPw carry RoomCredential — the same branded type the domain uses — while
  // pwInput is the raw editable text field (user input stays a string until accepted).
  let linkKey = $state<RoomCredential | undefined>(undefined);
  let storedPw = $state<RoomCredential | null>(null);
  let pwInput = $state('');

  $effect(() => {
    if (open) {
      linkKey = currentSecretKey() ?? undefined;
      storedPw = roomPassword().credential(room);
      pwInput = storedPw ?? '';
    }
  });

  const base = $derived(`${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`);
  // Keep the #k= key (when present) at the very end so it stays in the hash and the
  // role flag stays in the query string.
  const hashSuffix = $derived(linkKey ? `#k=${encodeURIComponent(linkKey)}` : '');
  const url = $derived(`${base}${hashSuffix}`);
  const readerUrl = $derived(`${base}&role=reader${hashSuffix}`);
  const encrypted = $derived(!!linkKey || !!storedPw || !!envPassword);
  const envOnly = $derived(!linkKey && !storedPw && !!envPassword);

  function makeSecureLink(): void {
    const key = rotateSecretKey();
    clearRoomPassword(room); // link and password are mutually exclusive
    linkKey = key;
    storedPw = null;
    pwInput = '';
    onSecurityChange?.();
    toasts.success(t.share.secureCreated);
  }

  function applyPassword(): void {
    const pw = pwInput.trim();
    setRoomPassword(room, pw); // empty string clears the entry
    clearSecretKey();
    linkKey = undefined;
    storedPw = parseRoomCredential(pw); // accept user input into the domain via the canonical parser
    onSecurityChange?.();
    toasts.success(pw ? t.share.passwordApplied : t.share.passwordRemoved);
  }

  function removeEncryption(): void {
    clearSecretKey();
    clearRoomPassword(room);
    linkKey = undefined;
    storedPw = null;
    pwInput = '';
    onSecurityChange?.();
    toasts.info(t.share.encryptionRemoved);
  }

  async function copyTo(text: string, el: HTMLInputElement | undefined, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toasts.success(label);
      onclose();
      return;
    } catch {
      /* fall through to the manual fallback */
    }
    el?.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    if (ok) {
      toasts.success(label);
      onclose();
    } else {
      toasts.info(t.share.copyManual);
    }
  }

  const copy = () => copyTo(url, inputEl, t.share.inviteCopied);
  const copyReader = () => copyTo(readerUrl, readerInputEl, t.share.viewOnlyCopied);
</script>

<Dialog {open} {onclose} title={t.share.title}>
  <p class="share-hint">
    {t.share.hint}
    {#if linkKey}
      <strong>{t.share.hintEncrypted}</strong>{t.share.hintEncryptedSuffix}
    {/if}
  </p>

  <div class="share-row">
    <input
      bind:this={inputEl}
      type="text"
      readonly
      value={url}
      aria-label={t.share.inviteLabel}
      onfocus={(e) => e.currentTarget.select()}
    />
    <button class="primary" onclick={copy}>{t.share.copyLink}</button>
  </div>

  <details class="reader-section">
    <summary>{t.share.viewOnly}</summary>
    <div class="reader-body">
      <div class="share-row">
        <input
          bind:this={readerInputEl}
          type="text"
          readonly
          value={readerUrl}
          aria-label={t.share.viewOnlyLabel}
          onfocus={(e) => e.currentTarget.select()}
        />
        <button onclick={copyReader}>{t.share.copyLink}</button>
      </div>
      <p class="reader-caveat">
        {t.share.viewOnlyCaveat} <code>role=reader</code> {t.share.viewOnlyCaveat2}
      </p>
    </div>
  </details>

  <section class="share-security">
    <h3>
      {t.share.privacy}
      {#if encrypted}<span class="lock" title={t.share.encryptedTitle}>{t.share.encrypted}</span>{/if}
    </h3>

    {#if envOnly}
      <p class="sec-note">{t.share.envOnlyNote}</p>
    {/if}

    {#if linkKey}
      <p class="sec-note">
        <strong>{t.share.secureNote}</strong> {t.share.secureNote2} <code>#</code> {t.share.secureNote3}
      </p>
      <div class="sec-actions">
        <button onclick={removeEncryption}>{t.share.removeEncryption}</button>
      </div>
    {:else}
      <p class="sec-note">{t.share.encryptNote}</p>
      <div class="sec-actions">
        <button class="primary" onclick={makeSecureLink}>{t.share.generateSecureLink}</button>
      </div>
      <div class="sec-pw">
        <input
          type="text"
          placeholder={t.share.orRoomPassword}
          value={pwInput}
          oninput={(e) => (pwInput = e.currentTarget.value)}
          onkeydown={(e) => e.key === 'Enter' && applyPassword()}
          aria-label={t.share.roomPasswordLabel}
        />
        <button onclick={applyPassword} disabled={pwInput.trim() === (storedPw ?? '')}>
          {storedPw ? t.share.update : t.share.set}
        </button>
        {#if storedPw}<button onclick={removeEncryption}>{t.share.remove}</button>{/if}
      </div>
      <small class="sec-help">{t.share.passwordHelp}</small>
    {/if}
  </section>

  <p class="share-room">
    {t.share.roomId} <code>{room}</code>
  </p>
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
