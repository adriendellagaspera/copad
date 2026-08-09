<script lang="ts">
  let {
    onConnectStorage,
    onDismiss,
  }: {
    /** Open Settings to connect a storage backend. */
    onConnectStorage: () => void;
    /** Acknowledge — the status chip and the sync banner carry it from here. */
    onDismiss: () => void;
  } = $props();
</script>

<!-- A card in the flow, never a modal over the document: what it explains is a
     standing property of the product, so it has no moment to interrupt (see
     docs/contract.md §7, "One-time dialogs, when they *are* right"). -->
<aside class="storage-intro">
  <p class="si-body">
    <strong>Where this goes.</strong> Copad has no server of its own: what you write
    travels straight to whoever is in the room with you, and a copy stays in this
    browser so a reload finds it again. That copy is not a backup — it lives and
    dies with this browser profile. Connect storage of your own and the document
    becomes a real file that outlives all of it.
  </p>
  <div class="si-actions">
    <button onclick={onConnectStorage}>Connect storage</button>
    <button class="ghost" onclick={onDismiss}>Got it</button>
  </div>
</aside>

<style>
  .storage-intro {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    padding: var(--sp-2) var(--sp-4);
    margin-bottom: var(--sp-4);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.4;
  }
  .si-body {
    margin: 0;
    flex: 1 1 18rem;
  }
  .si-body strong {
    color: var(--text);
  }
  .si-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
</style>
