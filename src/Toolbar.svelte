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

  // Tooltip shortcut hints, resolved for the real OS — the literal words
  // "Mod"/"Alt" don't exist on a Mac keyboard (⌘/⌥ instead), so hardcoding
  // them as static text was wrong on Mac regardless of which modifier it
  // named. Read once: like `src/editor/ui/shortcuts.ts`'s own `parseOS()`
  // default, this doesn't need to react to a runtime OS change (there isn't
  // one — the browser doesn't switch operating systems mid-session).
  const os = parseOS();
  const mod = modKey(os);
  const alt = altKey(os);

  type Props = {
    view: EditorView | null;
    editorState: EditorState | null;
    toasts: Toasts;
    // Desktop's SelectionToolbar shows table-structure commands in their own
    // floating panel (see TableToolbar.svelte) instead of merged into this
    // row, so it sets this false on its embedded Toolbar. The mobile fixed
    // dock has no such second panel, so it leaves this at the default and
    // keeps everything in one flat row.
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

  // Block-type commands: table cells hold real block content now (see
  // schema.ts), so most of these apply there too — a blanket "hide all of
  // this in any table" is no longer right. Each button decides its own
  // visibility from a dry run of its own command (called with no dispatch,
  // the standard ProseMirror way to ask "would this apply here?" without
  // mutating anything) — the same mechanism that already governs whether a
  // button lights up as *active*, just answering "applicable" instead of
  // "already on". This also naturally covers other already-existing dead
  // spots (e.g. inside a code block) with no separate flag needed.
  // insertTable is the one command that keeps a real, permanent exclusion —
  // nesting tables isn't supported — but that already lives in the command
  // itself (isInTable), so its own dry run already reflects it.
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
  <!-- Prevent default on pointerdown so tapping a button never blurs the
       ProseMirror content first: on mobile that blur (via Editor.svelte's
       focusout tracking) would swap the bottom dock away from this exact
       toolbar mid-tap. The click still fires and runs the command normally. -->
  <div class="toolbar" role="toolbar" aria-label="Formatting" onpointerdown={(e) => e.preventDefault()}>
    <button data-active={bold}   aria-pressed={bold}   onclick={run(commands.bold)}   title="Bold ({mod}+B)" aria-label="Bold"><b>B</b></button>
    <button data-active={italic} aria-pressed={italic} onclick={run(commands.italic)} title="Italic ({mod}+I)" aria-label="Italic"><i>I</i></button>
    <button data-active={strike} aria-pressed={strike} onclick={run(commands.strike)} title="Strikethrough ({mod}+Shift+X, or ~~text~~)" aria-label="Strikethrough"><s>S</s></button>
    <button data-active={underline} aria-pressed={underline} onclick={run(commands.underline)} title="Underline ({mod}+Shift+U)" aria-label="Underline"><u>U</u></button>
    <button data-active={code}   aria-pressed={code}   onclick={run(commands.code)}   title="Inline code ({mod}+Shift+C, or &#96;text&#96;)" aria-label="Inline code">{'</>'}</button>
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
      {#if canChecklist}<button data-active={checklist} aria-pressed={checklist} onclick={run(commands.taskList)} title="Checklist ({mod}+Shift+6, or [] + space)" aria-label="Checklist">☑</button>{/if}
      {#if canQuote}<button data-active={quote} aria-pressed={quote} onclick={run(commands.blockquote)} title="Blockquote ({mod}+Shift+9, or > + space)" aria-label="Blockquote">❝</button>{/if}
      {#if canCodeblock}<button data-active={codeblock} aria-pressed={codeblock} onclick={run(commands.codeBlock)} title="Code block ({mod}+{alt}+C, or &#96;&#96;&#96; )">Code</button>{/if}
      {#if canDivider}<button onclick={run(commands.horizontalRule)} title="Divider (type ---)" aria-label="Insert divider">―</button>{/if}
    {/if}
    {#if canInsertTable}
      <span class="sep" role="separator"></span>
      <button onclick={run(commands.insertTable)} title="Insert 3×3 table" aria-label="Insert table">▦</button>
    {/if}
    {#if inTable && showTableStructure}
      <span class="sep" role="separator"></span>
      <TableToolbar {view} />
    {/if}
    <span class="sep" role="separator"></span>
    <button onclick={run(commands.undo)} title="Undo ({mod}+Z)" aria-label="Undo">↶</button>
    <button onclick={run(commands.redo)} title="Redo ({mod}+Y)" aria-label="Redo">↷</button>
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
