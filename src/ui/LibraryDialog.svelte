<script lang="ts">
  import type { RoomId } from '../collaboration/types.js';
  import { SessionRole } from '../collaboration/types.js';
  import {
    roomHistory,
    forgetRoom,
    roomVisitUrl,
    type RoomVisit,
    type PagePath,
  } from '../collaboration/roomHistory.js';
  import type { EpochMs } from '../time.js';
  import Dialog from './Dialog.svelte';

  let {
    open,
    onclose,
    current,
    page,
    onNew,
  }: {
    open: boolean;
    onclose: () => void;
    /** The room this tab is in, marked in the list so it isn't reopened blindly. */
    current: RoomId;
    /** Page path every entry's link is built against. */
    page: PagePath;
    /** Create a new document (a new room, in a new tab). */
    onNew: () => void;
  } = $props();

  let forgotten = $state(0);
  const visits = $derived.by((): RoomVisit[] => {
    void forgotten;
    return open ? roomHistory() : [];
  });

  function forget(room: RoomId): void {
    forgetRoom(room);
    forgotten += 1;
  }

  // Unnamed rooms are all "Untitled"; without this the list is rows of the same
  // word and picking one is guesswork.
  function roomTail(room: RoomId): string {
    return room.slice(-4);
  }

  function openedLabel(at: EpochMs): string {
    const when = new Date(at);
    const sameDay = new Date().toDateString() === when.toDateString();
    return sameDay
      ? when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
</script>

<Dialog {open} {onclose} title="Your documents">
  <p class="lib-intro">
    Rooms this browser has opened. The list is kept on this device only — nobody
    else sees it, and clearing your browser data clears it.
  </p>

  {#if visits.length === 0}
    <p class="lib-empty">Nothing here yet. Documents you open show up in this list.</p>
  {:else}
    <ul class="lib-list">
      {#each visits as visit (visit.room)}
        <li class:lib-current={visit.room === current}>
          <a class="lib-open" href={roomVisitUrl(visit, page)}>
            <span class="lib-name">
              {visit.name ?? 'Untitled'}
              {#if !visit.name}<span class="lib-discriminator">{roomTail(visit.room)}</span>{/if}
            </span>
            <span class="lib-meta">
              {#if visit.key}<span title="End-to-end encrypted" aria-label="Encrypted">🔒</span>{/if}
              {#if visit.role === SessionRole.Reader}<span class="lib-tag">View-only</span>{/if}
              <span>{visit.room === current ? 'Open here' : openedLabel(visit.openedAt)}</span>
            </span>
          </a>
          <button
            class="ghost lib-forget"
            onclick={() => forget(visit.room)}
            title="Remove from this list"
            aria-label={`Remove ${visit.name ?? visit.room} from this list`}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="lib-actions">
    <button class="primary" onclick={onNew}>New document</button>
  </div>
</Dialog>

<style>
  .lib-intro,
  .lib-empty {
    margin: 0 0 var(--sp-3);
    color: var(--text-muted);
    font-size: var(--fs-300);
    line-height: 1.5;
  }
  .lib-list {
    list-style: none;
    margin: 0 0 var(--sp-3);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    max-height: 320px;
    overflow-y: auto;
  }
  .lib-list li {
    display: flex;
    align-items: stretch;
    gap: var(--sp-1);
  }
  .lib-open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--text);
    text-decoration: none;
  }
  .lib-open:hover {
    background: var(--surface-2);
  }
  .lib-current .lib-open {
    border-color: var(--accent);
  }
  .lib-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lib-discriminator {
    margin-left: var(--sp-1);
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--fs-300);
  }
  .lib-meta {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    flex: none;
    color: var(--text-faint);
    font-size: var(--fs-300);
  }
  .lib-tag {
    white-space: nowrap;
  }
  .lib-forget {
    flex: none;
    min-width: 44px;
    color: var(--text-faint);
    border: none;
  }
  .lib-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
</style>
