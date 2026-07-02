<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { Toasts } from './toasts.svelte.js';
  import type { RoomId } from '../collaboration/types.js';
  import { roomPassword, setRoomPassword, clearRoomPassword, type RoomCredential } from '../collaboration/roomAccess.js';
  import { parseRoomCredential } from '../collaboration/parse.js';
  import { currentSecretKey, clearSecretKey, rotateSecretKey } from '../collaboration/secretLink.js';
  import { rememberRoomEncryption, forgetRoomEncryption } from '../collaboration/roomLock.js';
  import { migrateRoomCache } from '../collaboration/cache.js';

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

  // The room's currently-effective per-room key (secure link takes precedence over
  // a stored password), before whatever change we're about to make.
  const currentKey = (): RoomCredential | null => linkKey ?? storedPw ?? null;

  // Changing encryption does three things, in order: record the new key's
  // fingerprint (so a later keyless visit is gated), migrate the local cache from
  // the old key to the new one (content survives; no copy is left readable under
  // the old key), then reconnect. All awaited *before* onSecurityChange so the
  // editor remounts against an already-migrated cache and correct registry.
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
    toasts.success('Secure link created — anyone with the link can read this room');
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
    toasts.success(pw ? 'Room password applied' : 'Room password removed');
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
    onSecurityChange?.();
    toasts.info('Encryption removed from this room');
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
      toasts.info('Press ⌘/Ctrl+C to copy the selected link');
    }
  }

  const copy = () => copyTo(url, inputEl, 'Invite link copied to clipboard');
  const copyReader = () => copyTo(readerUrl, readerInputEl, 'View-only link copied to clipboard');
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

  <details class="reader-section">
    <summary>Share a view-only link</summary>
    <div class="reader-body">
      <div class="share-row">
        <input
          bind:this={readerInputEl}
          type="text"
          readonly
          value={readerUrl}
          aria-label="View-only invite link"
          onfocus={(e) => e.currentTarget.select()}
        />
        <button onclick={copyReader}>Copy link</button>
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
        <button onclick={applyPassword} disabled={pwInput.trim() === (storedPw ?? '')}>
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
