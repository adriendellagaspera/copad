<script lang="ts">
  import Dialog from './Dialog.svelte';

  let {
    open,
    onWriteSolo,
    onInvite,
    onConnectStorage,
    onDismiss,
  }: {
    open: boolean;
    /** Opt into writing solo right away — lifts the gate immediately, same as the
     *  first keystroke would. */
    onWriteSolo: () => void;
    /** Open the Share dialog to invite a collaborator. */
    onInvite: () => void;
    /** Open Settings to connect a storage backend. */
    onConnectStorage: () => void;
    /** Close without choosing — falls back to the ambient SyncBanner + the
     *  type-to-write-solo gate, unchanged. */
    onDismiss: () => void;
  } = $props();
</script>

<Dialog {open} onclose={onDismiss} title="You're the only one here">
  <p class="wg-body">
    Copad is peer-to-peer by default: nothing you write leaves this device until
    another device is here to receive it. Leave before someone joins, and whatever
    you wrote is gone — like talking in an empty room, or notes on a scrap of paper
    you never handed to anyone.
  </p>
  <p class="wg-sub">This explanation only shows once — after this, a quieter reminder does the job.</p>
  <div class="wg-actions">
    <button class="primary" onclick={onWriteSolo}>Write here anyway</button>
    <button onclick={onInvite}>Invite someone</button>
    <button onclick={onConnectStorage}>Connect storage</button>
  </div>
</Dialog>

<style>
  .wg-body {
    margin: 0 0 var(--sp-3);
    color: var(--text);
    font-size: var(--fs-400);
    line-height: 1.6;
  }
  .wg-sub {
    margin: 0 0 var(--sp-4);
    color: var(--text-faint);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .wg-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
</style>
