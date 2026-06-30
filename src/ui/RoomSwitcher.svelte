<script lang="ts">
  import type { RoomId, RoomName } from '../collaboration/types.js';
  import { recentRooms } from '../collaboration/recentRooms.js';

  type Props = {
    room: RoomId;
    name: RoomName | null;
    /** Apply a rename to the current room (shared, never changes the id). */
    onRename: (raw: string) => void;
    /** Open another room by id (navigates + remounts the editor). */
    onOpen: (idOrUrl: string) => void;
  };

  let { room, name, onRename, onOpen }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | undefined>();
  let joinValue = $state('');

  // Recent rooms minus the one we're already in — most-recent first.
  // recentRooms() reads localStorage (not reactive), so depend on `open` and
  // `room` to re-read each time the menu opens or the active room changes.
  const others = $derived.by(() => {
    void open;
    void room;
    return recentRooms().filter((r) => r.id !== room);
  });

  function close(): void {
    open = false;
    joinValue = '';
  }

  function pick(id: RoomId): void {
    close();
    onOpen(id);
  }

  function joinSubmit(): void {
    const v = joinValue.trim();
    if (!v) return;
    close();
    onOpen(v);
  }

  // Close on outside click / Escape while open.
  $effect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="room-switcher" bind:this={root}>
  <span class="room-sigil" aria-hidden="true">#</span>
  <input
    class="room-name-input"
    aria-label="Room name"
    placeholder={room}
    value={name ?? ''}
    oninput={(e) => onRename(e.currentTarget.value)}
    title={'Room name — the room id ('+room+') never changes when you rename it'}
  />
  <button
    class="switch-btn"
    aria-haspopup="menu"
    aria-expanded={open}
    title="Switch room"
    aria-label="Switch room"
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  </button>

  {#if open}
    <div class="switch-menu" role="menu">
      <div class="switch-section">
        <p class="switch-label">Recent rooms</p>
        {#if others.length === 0}
          <p class="switch-empty">No other rooms yet.</p>
        {:else}
          {#each others as r (r.id)}
            <button class="switch-item" role="menuitem" onclick={() => pick(r.id)} title={r.id}>
              <span class="switch-item-name">{r.name ?? r.id}</span>
              {#if r.name}<span class="switch-item-id">#{r.id}</span>{/if}
            </button>
          {/each}
        {/if}
      </div>
      <div class="switch-section">
        <p class="switch-label">Open a room</p>
        <form
          class="switch-join"
          onsubmit={(e) => { e.preventDefault(); joinSubmit(); }}
        >
          <input
            class="switch-join-input"
            placeholder="room id or shared URL"
            bind:value={joinValue}
            aria-label="Open a room by id or URL"
          />
          <button class="switch-join-go" type="submit" disabled={!joinValue.trim()}>Open</button>
        </form>
      </div>
    </div>
  {/if}
</div>

<style>
  .room-switcher {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    background: var(--surface);
    padding-left: 0.5rem;
  }
  .room-switcher:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--selection);
  }
  .room-sigil {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: var(--fs-400);
    color: var(--text-faint);
    line-height: 1;
    user-select: none;
  }
  .room-name-input {
    font-family: var(--font-mono);
    width: 9rem;
    border: none;
    background: transparent;
    padding: 0.4rem 0.3rem 0.4rem 0.35rem;
  }
  .room-name-input:focus-visible {
    outline: none;
    box-shadow: none;
  }
  .switch-btn {
    border: none;
    border-left: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
    padding: 0.4rem 0.4rem;
    min-width: 0;
  }
  .switch-btn:hover:not(:disabled) {
    background: var(--surface-3);
    color: var(--text);
  }
  .switch-btn svg {
    display: block;
  }

  .switch-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: var(--z-menu);
    min-width: 17rem;
    max-width: 22rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
    padding: var(--sp-2);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    animation: switch-in var(--dur-fast) var(--ease);
  }
  @keyframes switch-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .switch-section {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .switch-section + .switch-section {
    border-top: 1px solid var(--border);
    padding-top: var(--sp-2);
  }
  .switch-label {
    margin: 0 0 0.15rem;
    padding: 0 0.35rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }
  .switch-empty {
    margin: 0;
    padding: 0.1rem 0.35rem 0.25rem;
    font-size: var(--fs-300);
    color: var(--text-faint);
  }
  .switch-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    width: 100%;
    border: none;
    background: transparent;
    border-radius: var(--r-sm);
    padding: 0.35rem 0.35rem;
    text-align: left;
  }
  .switch-item:hover:not(:disabled) {
    background: var(--surface-3);
  }
  .switch-item-name {
    font-size: var(--fs-300);
    color: var(--text);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .switch-item-id {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-faint);
  }
  .switch-join {
    display: flex;
    gap: var(--sp-2);
    align-items: center;
    padding: 0 0.35rem;
  }
  .switch-join-input {
    flex: 1;
    min-width: 0;
  }
  .switch-join-go {
    flex-shrink: 0;
  }

  /* On narrow screens the switcher spans the row, so let the name input grow. */
  @media (max-width: 720px) {
    .room-switcher {
      width: 100%;
    }
    .room-name-input {
      width: auto;
      flex: 1;
    }
  }
</style>
