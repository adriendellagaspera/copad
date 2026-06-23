<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import { isMarkActive, isNodeActive, runCommand, commands } from './editor/commands.js';
  import { schema } from './editor/schema.js';

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
  };

  let { view, editorState }: Props = $props();

  const bold    = $derived(editorState ? isMarkActive(editorState, schema.marks.strong) : false);
  const italic  = $derived(editorState ? isMarkActive(editorState, schema.marks.em)     : false);
  const code    = $derived(editorState ? isMarkActive(editorState, schema.marks.code)   : false);
  const strike  = $derived(editorState ? isMarkActive(editorState, schema.marks.strike) : false);
  const h1      = $derived(editorState ? isNodeActive(editorState, schema.nodes.heading,  { level: 1 }) : false);
  const h2      = $derived(editorState ? isNodeActive(editorState, schema.nodes.heading,  { level: 2 }) : false);
  const bullet  = $derived(editorState ? isNodeActive(editorState, schema.nodes.bullet_list)  : false);
  const ordered = $derived(editorState ? isNodeActive(editorState, schema.nodes.ordered_list) : false);
  const quote   = $derived(editorState ? isNodeActive(editorState, schema.nodes.blockquote)   : false);

  const run = (cmd: (typeof commands)[keyof typeof commands]) => () => {
    if (view) runCommand(view, cmd);
  };
</script>

{#if view}
<div class="toolbar" role="toolbar" aria-label="Formatting">
  <button data-active={bold}    onclick={run(commands.bold)}      title="Bold (Mod+B)"><b>B</b></button>
  <button data-active={italic}  onclick={run(commands.italic)}    title="Italic (Mod+I)"><i>I</i></button>
  <button data-active={strike}  onclick={run(commands.strike)}    title="Strikethrough"><s>S</s></button>
  <button data-active={code}    onclick={run(commands.code)}      title="Inline code (Mod+`)">{'</>'}</button>
  <span class="sep" role="separator"></span>
  <button data-active={h1}      onclick={run(commands.h1)}        title="Heading 1 (type # + space)">H1</button>
  <button data-active={h2}      onclick={run(commands.h2)}        title="Heading 2 (type ## + space)">H2</button>
  <span class="sep" role="separator"></span>
  <button data-active={bullet}  onclick={run(commands.bullet)}    title="Bullet list (type - + space)">• List</button>
  <button data-active={ordered} onclick={run(commands.ordered)}   title="Ordered list (type 1. + space)">1. List</button>
  <button data-active={quote}   onclick={run(commands.blockquote)} title="Blockquote (type > + space)">❝</button>
  <span class="sep" role="separator"></span>
  <button onclick={run(commands.undo)} title="Undo (Mod+Z)">↶</button>
  <button onclick={run(commands.redo)} title="Redo (Mod+Y)">↷</button>
</div>
{/if}
