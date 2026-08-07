<script lang="ts">
  import { exportCodecs } from '../format/index.js';
  import { downloadBytes } from '../format/download.js';
  import { exportBridge } from '../editor/exportBridge.svelte.js';
  import type { ExportCodec } from '../format/types.js';
  import type { Toasts } from './toasts.svelte.js';

  let { baseName, toasts, ondone }: { baseName: string; toasts: Toasts; ondone?: () => void } =
    $props();

  async function exportAs(codec: ExportCodec): Promise<void> {
    try {
      const bytes = await exportBridge.request(codec);
      await downloadBytes(bytes, `${baseName}${codec.extensions[0]}`);
      toasts.success(`Exported as ${codec.label}`);
    } catch (e) {
      toasts.error(`Export failed: ${(e as Error).message}`);
    }
    ondone?.();
  }

  // No client-side PDF library: window.print() + the dedicated print
  // stylesheet (src/styles/print.css) gives real, selectable text via the
  // browser's own renderer — "Save as PDF" in the native print dialog — for
  // zero bundle cost and better fidelity than an HTML-to-canvas library. Not
  // a Codec (there's nothing to encode ahead of time), so it's a plain
  // action alongside the codec-driven ones rather than another list item.
  function printToPdf(): void {
    ondone?.();
    window.print();
  }
</script>

<div class="export-formats">
  {#each exportCodecs as codec (codec.id)}
    <button class="export-item" onclick={() => exportAs(codec)} disabled={!exportBridge.available}>
      {codec.label}
      <span class="ext">{codec.extensions[0]}</span>
    </button>
  {/each}
  <button
    class="export-item"
    onclick={printToPdf}
    title="Opens the browser print dialog — choose “Save as PDF”"
  >
    PDF (print)
  </button>
</div>

<style>
  .export-formats {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .export-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    width: 100%;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    text-align: left;
    font-size: var(--fs-300);
    color: var(--text);
  }
  .export-item:hover:not(:disabled) {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }
  .export-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .export-item .ext {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--fs-200);
  }
</style>
