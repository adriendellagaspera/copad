<script lang="ts">
  import Dialog from './Dialog.svelte';
  import type { RoomId } from '../collaboration/types.js';
  import { recentDocsStore, type RecentDoc } from '../collaboration/recentDocs.js';
  import { now, type EpochMs } from '../time.js';

  let {
    current,
    buttonClass = 'cap-btn',
  }: { current: RoomId; buttonClass?: string } = $props();

  const store = recentDocsStore();
  let open = $state(false);
  let docs = $state<RecentDoc[]>([]);

  function refresh(): void {
    docs = store.all().filter((d) => d.room !== current);
  }

  function show(): void {
    refresh();
    open = true;
  }

  function openDoc(doc: RecentDoc): void {
    window.open(doc.url, '_blank', 'noopener');
  }

  function removeDoc(room: RoomId): void {
    store.remove(room);
    refresh();
  }

  function relativeTime(at: EpochMs): string {
    const minutes = Math.round((now() - at) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }
</script>

<button
  class={buttonClass}
  onclick={show}
  title="Recent documents"
  aria-label="Recent documents"
>
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
  </svg>
</button>

<Dialog {open} onclose={() => (open = false)} title="Recent documents">
  {#if docs.length === 0}
    <p class="recent-empty">No other recent documents yet.</p>
  {:else}
    <ul class="recent-list">
      {#each docs as doc (doc.room)}
        <li class="recent-row">
          <button class="recent-open" onclick={() => openDoc(doc)}>
            <span class="recent-title">{doc.title ?? doc.room}</span>
            <span class="recent-time">{relativeTime(doc.lastOpened)}</span>
          </button>
          <button
            class="ghost recent-remove"
            onclick={() => removeDoc(doc.room)}
            title="Remove from recent documents"
            aria-label={`Remove ${doc.title ?? doc.room} from recent documents`}
          >
            ✕
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Dialog>

<style>
  .recent-empty {
    color: var(--text-muted);
    font-size: var(--fs-300);
    margin: 0;
    padding: var(--sp-2) 0;
  }
  .recent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    max-height: 320px;
    overflow-y: auto;
  }
  .recent-row {
    display: flex;
    align-items: stretch;
    gap: var(--sp-1);
  }
  .recent-open {
    flex: 1;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-2);
    min-width: 0;
    text-align: left;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .recent-open:hover {
    background: var(--surface-2);
  }
  .recent-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-time {
    flex: none;
    color: var(--text-muted);
    font-size: var(--fs-300);
  }
  .recent-remove {
    flex: none;
    padding: 0 var(--sp-2);
    color: var(--text-muted);
  }
  .recent-remove:hover {
    color: var(--text);
  }
</style>
