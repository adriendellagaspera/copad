<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { Toasts } from './toasts.svelte.js';

  let {
    open,
    onclose,
    room,
    toasts,
  }: {
    open: boolean;
    onclose: () => void;
    room: string;
    toasts: Toasts;
  } = $props();

  let inputEl = $state<HTMLInputElement | undefined>();
  let readerInputEl = $state<HTMLInputElement | undefined>();

  const url = $derived(
    `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`
  );

  const readerUrl = $derived(`${url}&role=reader`);

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
