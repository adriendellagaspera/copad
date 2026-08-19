<script lang="ts">
  import type { RoomId, RoomName } from '../../collaboration/types.js';
  import type { Milliseconds } from '../../time.js';

  type Props = {
    room: RoomId;
    name: RoomName | null;
    onRename: (raw: string) => void;
    autofocus?: boolean;
  };

  let { room, name, onRename, autofocus = false }: Props = $props();

  const RENAME_DEBOUNCE = 400 as Milliseconds;
  let renameTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleRename(raw: string): void {
    clearTimeout(renameTimer);
    renameTimer = setTimeout(() => onRename(raw), RENAME_DEBOUNCE);
  }

  function commitRename(raw: string): void {
    clearTimeout(renameTimer);
    onRename(raw);
  }

  const isFinePointer = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  function autofocusInput(node: HTMLInputElement): void {
    // Skip on touch: this would pop the keyboard on a tab the user didn't tap into.
    if (!autofocus || !isFinePointer()) return;
    node.focus();
    node.select();
  }
</script>

<div class="doc-title">
  <span class="sigil" aria-hidden="true">#</span>
  <input
    class="title-input"
    aria-label="Room name"
    placeholder="Untitled"
    value={name ?? ''}
    oninput={(e) => scheduleRename(e.currentTarget.value)}
    onblur={(e) => commitRename(e.currentTarget.value)}
    onkeydown={(e) => { if (e.key === 'Enter') commitRename(e.currentTarget.value); }}
    use:autofocusInput
    title={'Room name — the room id (' + room + ') never changes when you rename it'}
  />
</div>

<style>
  .doc-title {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    /* Same value as About's own .doc-title (About.svelte) — kept identical on purpose. */
    margin: 0 0 var(--sp-3);
  }
  .sigil {
    font-family: var(--font-read);
    font-weight: 600;
    font-size: var(--fs-700);
    color: var(--text-faint);
    line-height: 1;
    user-select: none;
  }
  .title-input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-read);
    font-weight: 600;
    font-size: var(--fs-700);
    line-height: 1.25;
    border: none;
    background: transparent;
    padding: 0;
    color: var(--text-faint);
  }
  .title-input:focus {
    color: var(--text-muted);
  }
  .title-input:focus-visible {
    outline: none;
    box-shadow: none;
  }
</style>
