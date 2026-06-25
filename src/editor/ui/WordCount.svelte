<script lang="ts">
  import type { EditorState } from 'prosemirror-state';

  let { editorState }: { editorState: EditorState | null } = $props();

  const plain = $derived(
    editorState ? editorState.doc.textBetween(0, editorState.doc.content.size, ' ', ' ') : ''
  );
  const words = $derived(plain.trim() ? plain.trim().split(/\s+/).length : 0);
  const chars = $derived(editorState ? editorState.doc.textContent.length : 0);
</script>

<span class="wordcount" title="{chars} characters">
  {words}
  {words === 1 ? 'word' : 'words'}
</span>

<style>
  .wordcount {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
