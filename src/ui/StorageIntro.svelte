<script lang="ts">
  let {
    onConnectStorage,
    onDismiss,
  }: {
    onConnectStorage: () => void;
    onDismiss: () => void;
  } = $props();
</script>

<!-- A card in the flow, never a modal: it explains a standing fact, with no moment to interrupt (docs/contract.md §7). -->
<aside class="storage-intro">
  <p class="si-body">
    <strong>Nothing here is saved yet.</strong> This document lives in this browser
    only, and goes when it does.
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
