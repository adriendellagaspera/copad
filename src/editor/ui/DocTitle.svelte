<script lang="ts">
  import type { RoomId, RoomName } from '../../collaboration/types.js';
  import type { Milliseconds } from '../../time.js';

  type Props = {
    room: RoomId;
    name: RoomName | null;
    /** Apply a rename to the current room (shared, never changes the id). */
    onRename: (raw: string) => void;
    /** Focus and select the input on mount (fresh tab from "New document"); desktop only. */
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
    if (!autofocus || !isFinePointer()) return;
    node.focus();
    node.select();
  }
</script>

<!-- Lives inside `.content` (Editor.svelte), above the ProseMirror surface — it's
     the first thing in the document, not header chrome, so it scrolls away with
     the rest of the page instead of costing permanent space. Muted rather than
     full ink so it never reads as a heading *authored* in the document itself
     (a real H1 the user types keeps normal text color); the "#" sigil + mono
     face carry over from the old header field, marking this as an identifier,
     not prose. -->
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
    padding: var(--sp-2) 0 var(--sp-4);
  }
  .sigil {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: var(--fs-700);
    color: var(--text-faint);
    line-height: 1;
    user-select: none;
  }
  .title-input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
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
