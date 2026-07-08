<script lang="ts">
  import type { RoomId, RoomName } from '../collaboration/types.js';

  type Props = {
    room: RoomId;
    name: RoomName | null;
    /** Apply a rename to the current room (shared, never changes the id). */
    onRename: (raw: string) => void;
  };

  let { room, name, onRename }: Props = $props();
</script>

<div class="room-switcher">
  <span class="room-sigil" aria-hidden="true">#</span>
  <input
    class="room-name-input"
    aria-label="Room name"
    placeholder={room}
    value={name ?? ''}
    oninput={(e) => onRename(e.currentTarget.value)}
    title={'Room name — the room id ('+room+') never changes when you rename it'}
  />
</div>

<style>
  /* Behaves like a search-bar segment inside the header capsule: no border or
     fill until hover/focus, so it never competes visually with the capsule's
     one true accent, the Share button. */
  .room-switcher {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    height: 36px;
    border-radius: var(--r-full);
    background: transparent;
    padding: 0 10px;
    transition: background var(--dur-fast) var(--ease);
  }
  .room-switcher:hover {
    background: var(--surface-3);
  }
  /* :focus-within has no ":visible" variant of its own, so gate it manually
     on tracked input modality (src/ui/inputModality.ts) — otherwise this
     shows on every mouse click into the field, unlike the rest of the app. */
  :global(:root[data-input-modality='keyboard']) .room-switcher:focus-within {
    background: var(--surface-3);
    box-shadow: 0 0 0 2px var(--selection);
  }
  .room-sigil {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: var(--fs-300);
    color: var(--text-faint);
    line-height: 1;
    user-select: none;
  }
  .room-name-input {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    width: 8.5rem;
    border: none;
    background: transparent;
    padding: 0;
    color: var(--text-muted);
  }
  .room-name-input:focus {
    color: var(--text);
  }
  /* Extra `.room-switcher` ancestor bumps specificity above app.css's
     modality-gated `input:focus-visible` rule (which now includes a
     :root[...] attribute selector and would otherwise win) — this input
     relies solely on the wrapping pill's own :focus-within ring below, so
     the two don't double up as separate, misaligned overlays. */
  .room-switcher .room-name-input:focus-visible {
    outline: none;
    box-shadow: none;
  }

  /* Mobile (M3): the header capsule shrinks to a small floating pill holding
     only this field (see header.capsule's combined pointer:coarse-or-narrow
     rule in app.css) — so it drops its own chrome too, becoming plain
     centered text until tapped. Same trigger as the capsule shrink it lives
     inside. The pill itself is pointer-events:none there (so a scroll/drag
     starting anywhere on its small footprint falls through to the document
     below) — this field opts back in so tapping/typing the name still
     works. Long names truncate with an ellipsis rather than wrapping or
     growing the pill — there's no room to spare at this size. */
  @media (pointer: coarse), (max-width: 900px) {
    .room-switcher {
      height: auto;
      border: none;
      background: transparent;
      padding-left: 0;
      justify-content: center;
      width: auto;
      max-width: 100%;
      pointer-events: auto;
    }
    .room-sigil {
      display: none;
    }
    .room-name-input {
      width: auto;
      max-width: 100%;
      text-align: center;
      padding: 0.3rem 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
</style>
