<script lang="ts">
  import type { DialogOpen, DialogTitle } from './types.js';
  import Dialog from './Dialog.svelte';

  let {
    open,
    saved,
    storageLabel,
    onConnectStorage,
    onDismiss,
  }: {
    open: DialogOpen;
    saved: boolean;
    storageLabel: string | null;
    onConnectStorage: () => void;
    onDismiss: () => void;
  } = $props();

  const TITLE = "This site can't sync in real time" as DialogTitle;
</script>

<Dialog {open} onclose={onDismiss} title={TITLE}>
  <p class="cu-body">
    This deployment isn't set up for real-time collaboration across devices —
    there's no signaling server to connect through. Nothing here is broken;
    it just means whatever you write stays on <strong>this device only</strong>{saved
      ? `, kept for you in ${storageLabel}`
      : ''}. Inviting someone won't help — they'd land on their own, separate copy.
  </p>
  <p class="cu-sub">This explanation only shows once — after this, a quieter reminder does the job.</p>
  <div class="cu-actions">
    <button class="primary" onclick={onDismiss}>Got it</button>
    {#if !saved}
      <button onclick={onConnectStorage}>Connect storage</button>
    {/if}
  </div>
</Dialog>

<style>
  .cu-body {
    margin: 0 0 var(--sp-3);
    color: var(--text);
    font-size: var(--fs-400);
    line-height: 1.6;
  }
  .cu-sub {
    margin: 0 0 var(--sp-4);
    color: var(--text-faint);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .cu-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
</style>
