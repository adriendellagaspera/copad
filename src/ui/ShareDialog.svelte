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

  const url = $derived(
    `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`
  );

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
</style>
