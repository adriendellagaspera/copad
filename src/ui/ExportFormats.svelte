<script lang="ts">
  import { exportCodecs } from '../format/index.js';
  import { downloadBytes } from '../format/download.js';
  import { exportBridge } from '../editor/exportBridge.svelte.js';
  import type { Codec } from '../format/types.js';
  import type { Toasts } from './toasts.svelte.js';

  let { baseName, toasts, ondone }: { baseName: string; toasts: Toasts; ondone?: () => void } =
    $props();

  async function exportAs(codec: Codec): Promise<void> {
    try {
      const bytes = await exportBridge.request(codec);
      await downloadBytes(bytes, `${baseName}${codec.extensions[0]}`);
      toasts.success(`Exported as ${codec.label}`);
    } catch (e) {
      toasts.error(`Export failed: ${(e as Error).message}`);
    }
    ondone?.();
  }
</script>

<div class="export-formats">
  {#each exportCodecs as codec (codec.id)}
    <button class="export-item" onclick={() => exportAs(codec)} disabled={!exportBridge.available}>
      {codec.label}
      <span class="ext">{codec.extensions[0]}</span>
    </button>
  {/each}
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
