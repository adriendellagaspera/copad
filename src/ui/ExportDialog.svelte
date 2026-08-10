<script lang="ts">
  import type { ExportBaseName } from '../format/download.js';
  import type { DialogOpen, DialogTitle } from './types.js';
  import Dialog from './Dialog.svelte';
  import ExportFormats from './ExportFormats.svelte';
  import type { Toasts } from './toasts.svelte.js';

  let {
    open,
    onclose,
    baseName,
    toasts,
  }: { open: DialogOpen; onclose: () => void; baseName: ExportBaseName; toasts: Toasts } = $props();

  const TITLE = 'Export a copy' as DialogTitle;
</script>

<Dialog {open} {onclose} title={TITLE}>
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
