<script lang="ts">
  import Dialog from './Dialog.svelte';
  import ExportFormats from './ExportFormats.svelte';
  import type { Toasts } from './toasts.svelte.js';

  let {
    open,
    onclose,
    baseName,
    toasts,
  }: { open: boolean; onclose: () => void; baseName: string; toasts: Toasts } = $props();
</script>

<Dialog {open} {onclose} title="Export a copy">
  <p class="export-lead">
    A one-off copy of this document, independent of any connected storage backend.
    Works while read-only.
  </p>
  <ExportFormats {baseName} {toasts} ondone={onclose} />
</Dialog>

<style>
  .export-lead {
    margin: 0 0 var(--sp-3);
    color: var(--text-muted);
    font-size: var(--fs-300);
  }
</style>
