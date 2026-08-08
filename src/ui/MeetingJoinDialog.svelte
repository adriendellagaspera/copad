<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { Toasts } from './toasts.svelte.js';
  import { deriveMeetingRoom } from '../collaboration/meetingLink.js';

  let { open, onclose, toasts }: { open: boolean; onclose: () => void; toasts: Toasts } = $props();

  let inputEl = $state<HTMLInputElement | undefined>();
  let pending = $state(false);

  async function join(raw: string): Promise<void> {
    const trimmed = raw.trim();
    if (!trimmed || pending) return;
    pending = true;
    const derived = await deriveMeetingRoom(trimmed);
    pending = false;
    if (!derived) {
      toasts.error("That doesn't look like a meeting link");
      return;
    }
    window.open(
      `${location.pathname}?room=${encodeURIComponent(derived.room)}#k=${encodeURIComponent(derived.key)}`,
      '_blank',
      'noopener',
    );
    onclose();
  }

  // The whole action is "copy the meeting link, paste" — no separate Go click.
  function onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    e.preventDefault();
    void join(text);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') void join(inputEl?.value ?? '');
  }
</script>

<Dialog {open} {onclose} title="Join a meeting">
  <p class="join-hint">
    Paste a Zoom, Google Meet, or Teams link — pasting takes you straight into a pad shared by
    everyone who has that link. No Copad link needed first.
  </p>
  <input
    bind:this={inputEl}
    type="text"
    placeholder="Paste a meeting link…"
    disabled={pending}
    onpaste={onPaste}
    onkeydown={onKeydown}
  />
</Dialog>

<style>
  .join-hint {
    margin: 0 0 var(--sp-3);
    color: var(--text-muted);
    font-size: var(--fs-300);
  }
  input {
    width: 100%;
  }
</style>
