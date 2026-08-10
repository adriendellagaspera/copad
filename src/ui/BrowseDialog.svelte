<script lang="ts">
  import type { DialogOpen, DialogTitle } from './types.js';
  import type { StorageBackend } from '../storage/index.js';
  import type { Filename } from '../storage/types.js';
  import { docContentBytes } from '../storage/types.js';
  import { extensionOf } from '../format/types.js';
  import { knownExtensions } from '../format/index.js';
  import Dialog from './Dialog.svelte';

  let {
    open,
    backend,
    onclose,
    onImport,
  }: {
    open: DialogOpen;
    backend: StorageBackend | null;
    onclose: () => void;
    onImport: (bytes: Uint8Array, filename: Filename) => void;
  } = $props();

  const title = $derived(`Browse ${backend?.storage.label ?? ''}` as DialogTitle);

  let files = $state<Filename[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let picking = $state<Filename | null>(null);

  // Only files a codec can actually read are worth showing — anything else
  // would just bounce off the same check downstream, in Editor's applyImport().
  $effect(() => {
    const b = backend;
    if (!open || !b?.storage.list) return;
    loading = true;
    error = null;
    files = [];
    b.storage
      .list()
      .then((all) => {
        const known = new Set(knownExtensions());
        files = all.filter((f) => known.has(extensionOf(f)));
      })
      .catch((e: unknown) => {
        error = `Couldn't list files: ${(e as Error).message}`;
      })
      .finally(() => {
        loading = false;
      });
  });

  async function pick(filename: Filename): Promise<void> {
    if (!backend?.storage.loadFrom) return;
    picking = filename;
    error = null;
    try {
      const content = await backend.storage.loadFrom(filename);
      if (!content) {
        error = `"${filename}" is empty or no longer exists.`;
        return;
      }
      onImport(docContentBytes(content), filename);
      onclose();
    } catch (e) {
      error = `Couldn't import ${filename}: ${(e as Error).message}`;
    } finally {
      picking = null;
    }
  }
</script>

<Dialog {open} {onclose} title={title}>
  {#if loading}
    <p class="browse-status">Loading files…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if files.length === 0}
    <p class="browse-status">No importable files found.</p>
  {:else}
    <ul class="browse-list">
      {#each files as f (f)}
        <li>
          <button onclick={() => pick(f)} disabled={picking !== null}>
            {picking === f ? 'Importing…' : f}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Dialog>

<style>
  .browse-status {
    color: var(--text-muted);
    font-size: var(--fs-300);
    margin: 0;
    padding: var(--sp-2) 0;
  }
  .browse-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    max-height: 320px;
    overflow-y: auto;
  }
  .browse-list button {
    width: 100%;
    text-align: left;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .browse-list button:hover:not(:disabled) {
    background: var(--surface-2);
  }
</style>
