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
  /* :focus-within has no ":visible" variant of its own, so gate it manually
     on tracked input modality (src/ui/inputModality.ts) — otherwise this
     shows on every mouse click into the field, unlike the rest of the app. */
  :global(:root[data-input-modality='keyboard']) .room-switcher:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--selection);
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
  /* Extra `.room-switcher` ancestor bumps specificity above app.css's
     modality-gated `input:focus-visible` rule (which now includes a
     :root[...] attribute selector and would otherwise win) — this input
     relies solely on the wrapping pill's own :focus-within ring below, so
     the two don't double up as separate, misaligned overlays. */
  .room-switcher .room-name-input:focus-visible {
    outline: none;
    box-shadow: none;
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
