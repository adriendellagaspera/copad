<script lang="ts">
  import type { EditorState } from 'prosemirror-state';
  import { useI18n } from '../../i18n/index.svelte.js';

  let { editorState }: { editorState: EditorState | null } = $props();

  const i18n = useI18n();
  const t = $derived(i18n.t);

  const plain = $derived(
    editorState ? editorState.doc.textBetween(0, editorState.doc.content.size, ' ', ' ') : ''
  );
  const words = $derived(plain.trim() ? plain.trim().split(/\s+/).length : 0);
  const chars = $derived(editorState ? editorState.doc.textContent.length : 0);
</script>

<span class="wordcount" title={t.wordcount.characters(chars)}>
  {words}
  {words === 1 ? t.wordcount.word : t.wordcount.words}
</span>

<style>
  .wordcount {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
