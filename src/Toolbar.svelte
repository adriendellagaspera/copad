<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import { isMarkActive, isNodeActive, runCommand, commands } from './editor/commands.js';
  import { isLinkActive } from './editor/linkCommands.js';
  import { docToMarkdown } from './editor/markdown.js';
  import { schema } from './editor/schema.js';
  import type { Toasts } from './ui/toasts.svelte.js';
  import { useI18n } from './i18n/index.svelte.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
    toasts: Toasts;
  };

  let { view, editorState, toasts }: Props = $props();

  const i18n = useI18n();
  const t = $derived(i18n.t);

  const bold      = $derived(editorState ? isMarkActive(editorState, schema.marks.strong) : false);
  const italic    = $derived(editorState ? isMarkActive(editorState, schema.marks.em)     : false);
  const code      = $derived(editorState ? isMarkActive(editorState, schema.marks.code)   : false);
  const strike    = $derived(editorState ? isMarkActive(editorState, schema.marks.strike) : false);
  const link      = $derived(editorState ? isLinkActive(editorState) : false);
  const h1        = $derived(editorState ? isNodeActive(editorState, schema.nodes.heading, { level: 1 }) : false);
  const h2        = $derived(editorState ? isNodeActive(editorState, schema.nodes.heading, { level: 2 }) : false);
  const h3        = $derived(editorState ? isNodeActive(editorState, schema.nodes.heading, { level: 3 }) : false);
  const bullet    = $derived(editorState ? isNodeActive(editorState, schema.nodes.bullet_list)  : false);
  const ordered   = $derived(editorState ? isNodeActive(editorState, schema.nodes.ordered_list) : false);
  const quote     = $derived(editorState ? isNodeActive(editorState, schema.nodes.blockquote)   : false);
  const codeblock = $derived(editorState ? isNodeActive(editorState, schema.nodes.code_block)   : false);

  const run = (cmd: (typeof commands)[keyof typeof commands]) => () => {
    if (view) runCommand(view, cmd);
  };

  function openLink(): void {
    view?.dom.dispatchEvent(new CustomEvent('copad:link', { bubbles: true }));
  }

  async function copyMarkdown(): Promise<void> {
    if (!editorState) return;
    const md = docToMarkdown(editorState.doc);
    try {
      await navigator.clipboard.writeText(md);
      toasts.success(t.toolbar.copied);
    } catch {
      toasts.info(t.toolbar.copyFailed);
    }
  }
</script>

{#if view}
  <div class="toolbar" role="toolbar" aria-label={t.toolbar.label}>
    <button data-active={bold}   aria-pressed={bold}   onclick={run(commands.bold)}   title={t.toolbar.bold}><b>B</b></button>
    <button data-active={italic} aria-pressed={italic} onclick={run(commands.italic)} title={t.toolbar.italic}><i>I</i></button>
    <button data-active={strike} aria-pressed={strike} onclick={run(commands.strike)} title={t.toolbar.strikethrough}><s>S</s></button>
    <button data-active={code}   aria-pressed={code}   onclick={run(commands.code)}   title={t.toolbar.code}>{'</>'}</button>
    <button data-active={link}   aria-pressed={link}   onclick={openLink}             title={t.toolbar.linkTitle} aria-label={t.toolbar.linkLabel}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M15 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></svg>
    </button>
    <span class="sep" role="separator"></span>
    <button data-active={h1} aria-pressed={h1} onclick={run(commands.h1)} title={t.toolbar.h1}>H1</button>
    <button data-active={h2} aria-pressed={h2} onclick={run(commands.h2)} title={t.toolbar.h2}>H2</button>
    <button data-active={h3} aria-pressed={h3} onclick={run(commands.h3)} title={t.toolbar.h3}>H3</button>
    <span class="sep" role="separator"></span>
    <button data-active={bullet}    aria-pressed={bullet}    onclick={run(commands.bullet)}         title={t.toolbar.bulletList}>• List</button>
    <button data-active={ordered}   aria-pressed={ordered}   onclick={run(commands.ordered)}        title={t.toolbar.orderedList}>1. List</button>
    <button data-active={quote}     aria-pressed={quote}     onclick={run(commands.blockquote)}     title={t.toolbar.blockquote}>❝</button>
    <button data-active={codeblock} aria-pressed={codeblock} onclick={run(commands.codeBlock)}      title={t.toolbar.codeBlock}>Code</button>
    <button onclick={run(commands.horizontalRule)} title={t.toolbar.divider} aria-label={t.toolbar.dividerLabel}>―</button>
    <span class="sep" role="separator"></span>
    <button onclick={run(commands.undo)} title={t.toolbar.undo} aria-label={t.toolbar.undoLabel}>↶</button>
    <button onclick={run(commands.redo)} title={t.toolbar.redo} aria-label={t.toolbar.redoLabel}>↷</button>
    <span class="spacer"></span>
    <button class="md-btn" onclick={copyMarkdown} title={t.toolbar.copyMd}>{t.toolbar.copyMdShort}</button>
  </div>
{/if}

<style>
  .toolbar .spacer {
    margin-left: auto;
  }
  .md-btn {
    font-size: 0.78rem;
  }
</style>
