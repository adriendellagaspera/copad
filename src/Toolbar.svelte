<script lang="ts">
  import type { EditorView } from 'prosemirror-view';
  import type { EditorState } from 'prosemirror-state';
  import { isMarkActive, isNodeActive, runCommand, commands, isInTable } from './editor/commands.js';
  import { isLinkActive } from './editor/linkCommands.js';
  import { docToMarkdown } from './editor/markdown.js';
  import { schema } from './editor/schema.js';
  import TableToolbar from './editor/ui/TableToolbar.svelte';
  import { modKey, altKey, parseOS } from './ui/platform.js';
  import type { Toasts } from './ui/toasts.svelte.js';

  const os = parseOS();
  const mod = modKey(os);
  const alt = altKey(os);

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
    toasts: Toasts;
    showTableStructure?: boolean;
  };

  let { view, editorState, toasts, showTableStructure = true }: Props = $props();

  const bold      = $derived(editorState ? isMarkActive(editorState, schema.marks.strong) : false);
  const italic    = $derived(editorState ? isMarkActive(editorState, schema.marks.em)     : false);
  const code      = $derived(editorState ? isMarkActive(editorState, schema.marks.code)   : false);
  const strike    = $derived(editorState ? isMarkActive(editorState, schema.marks.strike) : false);
  const underline = $derived(editorState ? isMarkActive(editorState, schema.marks.underline) : false);
  const link      = $derived(editorState ? isLinkActive(editorState) : false);
  const h1        = $derived(editorState ? isNodeActive(editorState, schema.nodes.heading, { level: 1 }) : false);
  const h2        = $derived(editorState ? isNodeActive(editorState, schema.nodes.heading, { level: 2 }) : false);
  const h3        = $derived(editorState ? isNodeActive(editorState, schema.nodes.heading, { level: 3 }) : false);
  const bullet    = $derived(editorState ? isNodeActive(editorState, schema.nodes.bullet_list)  : false);
  const ordered   = $derived(editorState ? isNodeActive(editorState, schema.nodes.ordered_list) : false);
  const checklist = $derived(editorState ? isNodeActive(editorState, schema.nodes.task_list)    : false);
  const quote     = $derived(editorState ? isNodeActive(editorState, schema.nodes.blockquote)   : false);
  const codeblock = $derived(editorState ? isNodeActive(editorState, schema.nodes.code_block)   : false);
  const inTable   = $derived(editorState ? isInTable(editorState) : false);

  const canH1        = $derived(editorState ? commands.h1(editorState) : false);
  const canH2        = $derived(editorState ? commands.h2(editorState) : false);
  const canH3        = $derived(editorState ? commands.h3(editorState) : false);
  const canBullet    = $derived(editorState ? commands.bullet(editorState) : false);
  const canOrdered   = $derived(editorState ? commands.ordered(editorState) : false);
  const canChecklist = $derived(editorState ? commands.taskList(editorState) : false);
  const canQuote     = $derived(editorState ? commands.blockquote(editorState) : false);
  const canCodeblock = $derived(editorState ? commands.codeBlock(editorState) : false);
  const canDivider   = $derived(editorState ? commands.horizontalRule(editorState) : false);
  const canInsertTable = $derived(editorState ? commands.insertTable(editorState) : false);
  const showHeadings = $derived(canH1 || canH2 || canH3);
  const showBlocks   = $derived(canBullet || canOrdered || canChecklist || canQuote || canCodeblock || canDivider);

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
      toasts.success('Copied as Markdown');
    } catch {
      toasts.error('Copy failed — your browser blocked clipboard access');
    }
  }
</script>

{#if view}
  <!-- preventDefault on pointerdown: blurring the editor on mobile swaps this dock away mid-tap (Editor.svelte focusout tracking). -->
  <div class="toolbar" role="toolbar" aria-label="Formatting" onpointerdown={(e) => e.preventDefault()}>
    <button data-active={bold}   aria-pressed={bold}   onclick={run(commands.bold)}   title="Bold ({mod}+B)" aria-label="Bold">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5h5a3 3 0 0 1 0 6H8z" /><path d="M8 11h6a3 3 0 0 1 0 6H8z" /></svg>
    </button>
    <button data-active={italic} aria-pressed={italic} onclick={run(commands.italic)} title="Italic ({mod}+I)" aria-label="Italic">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5h6M7 19h6M14 5l-4 14" /></svg>
    </button>
    <button data-active={strike} aria-pressed={strike} onclick={run(commands.strike)} title="Strikethrough ({mod}+Shift+X, or ~~text~~)" aria-label="Strikethrough">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M16 6.5A4 2.5 0 0 0 12 4h-1a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1a4 2.5 0 0 1-4-2.5" /></svg>
    </button>
    <button data-active={underline} aria-pressed={underline} onclick={run(commands.underline)} title="Underline ({mod}+Shift+U)" aria-label="Underline">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v6a6 6 0 0 0 12 0V4" /><path d="M5 20h14" /></svg>
    </button>
    <button data-active={code}   aria-pressed={code}   onclick={run(commands.code)}   title="Inline code ({mod}+Shift+C, or &#96;text&#96;)" aria-label="Inline code">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l-5 6 5 6M15 6l5 6-5 6" /></svg>
    </button>
    <button data-active={link}   aria-pressed={link}   onclick={openLink}             title="Link ({mod}+K, or [text](url))" aria-label="Link">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M15 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></svg>
    </button>
    {#if showHeadings}
      <span class="sep" role="separator"></span>
      {#if canH1}<button data-active={h1} aria-pressed={h1} onclick={run(commands.h1)} title="Heading 1 ({mod}+{alt}+1, or # + space)">H1</button>{/if}
      {#if canH2}<button data-active={h2} aria-pressed={h2} onclick={run(commands.h2)} title="Heading 2 ({mod}+{alt}+2, or ## + space)">H2</button>{/if}
      {#if canH3}<button data-active={h3} aria-pressed={h3} onclick={run(commands.h3)} title="Heading 3 ({mod}+{alt}+3, or ### + space)">H3</button>{/if}
    {/if}
    {#if showBlocks}
      <span class="sep" role="separator"></span>
      {#if canBullet}<button data-active={bullet} aria-pressed={bullet} onclick={run(commands.bullet)} title="Bullet list ({mod}+Shift+8, or - + space)">• List</button>{/if}
      {#if canOrdered}<button data-active={ordered} aria-pressed={ordered} onclick={run(commands.ordered)} title="Ordered list ({mod}+Shift+7, or 1. + space)">1. List</button>{/if}
      {#if canChecklist}<button data-active={checklist} aria-pressed={checklist} onclick={run(commands.taskList)} title="Checklist ({mod}+Shift+6, or [] + space)" aria-label="Checklist">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12.5l2.5 2.5L16 9" /></svg>
      </button>{/if}
      {#if canQuote}<button data-active={quote} aria-pressed={quote} onclick={run(commands.blockquote)} title="Blockquote ({mod}+Shift+9, or > + space)" aria-label="Blockquote">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 6.5a2.3 2.3 0 1 1 0 4.6c-.2 3-1.3 5-3.3 6.4" /><path d="M16.5 6.5a2.3 2.3 0 1 1 0 4.6c-.2 3-1.3 5-3.3 6.4" /></svg>
      </button>{/if}
      {#if canCodeblock}<button data-active={codeblock} aria-pressed={codeblock} onclick={run(commands.codeBlock)} title="Code block ({mod}+{alt}+C, or &#96;&#96;&#96; )">Code</button>{/if}
      {#if canDivider}<button onclick={run(commands.horizontalRule)} title="Divider (type ---)" aria-label="Insert divider">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h4M10 12h4M16 12h4" /></svg>
      </button>{/if}
    {/if}
    {#if canInsertTable}
      <span class="sep" role="separator"></span>
      <button onclick={run(commands.insertTable)} title="Insert 3×3 table" aria-label="Insert table">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 16h18M9 4v16M15 4v16" /></svg>
      </button>
    {/if}
    {#if inTable && showTableStructure}
      <span class="sep" role="separator"></span>
      <TableToolbar {view} />
    {/if}
    <span class="sep" role="separator"></span>
    <button onclick={run(commands.undo)} title="Undo ({mod}+Z)" aria-label="Undo">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
    </button>
    <button onclick={run(commands.redo)} title="Redo ({mod}+Y)" aria-label="Redo">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
    </button>
    <span class="spacer"></span>
    <button class="md-btn" onclick={copyMarkdown} title="Copy document as Markdown">Copy MD</button>
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
