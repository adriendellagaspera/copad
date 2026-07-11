import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, Plugin } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';
import { tableNodeTypes, CellSelection, selectedRect } from 'prosemirror-tables';
import { yUndoPluginKey } from 'y-prosemirror';
import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { splitListItem } from 'prosemirror-schema-list';
import { schema } from './schema.js';
import {
  markRuleHandler,
  linkRuleHandler,
  escapeCodeBlock,
  exitCodeBlockDown,
  exitCodeBlockOnBlankLine,
  clearEmptyCodeBlockBackward,
  backspaceAtTableStart,
  deleteAtTableEnd,
  tableArrowVertical,
  tableArrowHorizontal,
  tableShiftArrow,
  tableGoalColumnKey,
  tableGoalColumnPlugin,
  tabAddsRowAtEnd,
  insertHardBreak,
  insertTabCharacter,
  removeTabCharacterBefore,
  toggleBlockType,
  checklistRuleHandler,
  horizontalRuleHandler,
  addRowAfter,
  BOLD_STAR_RULE,
  BOLD_UNDERSCORE_RULE,
  ITALIC_STAR_RULE,
  ITALIC_UNDERSCORE_RULE,
  STRIKE_RULE,
  CODE_RULE,
  LINK_RULE,
  CHECKLIST_RULE,
  HORIZONTAL_RULE_RULE,
  buildPlugins,
} from './plugins.js';

/** A bare 1×1 table (one header cell, no body row) — the smallest doc shape
 *  that can trap a caret at both the first and the last cell at once. The
 *  cell holds real block content (see schema.ts), so an empty cell still
 *  needs a child — `createAndFill()` gives it a single empty paragraph. */
function oneCellTable() {
  const types = tableNodeTypes(schema);
  return types.table.create(null, [types.row.create(null, [types.header_cell.createAndFill()!])]);
}

/** A one-paragraph doc containing `text`, with the handler invoked as if the
 *  caret sits right after `text` (mimicking the character that just closed
 *  the input rule). */
function run(
  text: string,
  regexp: RegExp,
  handler:
    | ReturnType<typeof markRuleHandler>
    | ReturnType<typeof linkRuleHandler>
    | ReturnType<typeof checklistRuleHandler>
    | ReturnType<typeof horizontalRuleHandler>
) {
  const para = schema.node('paragraph', null, schema.text(text));
  const doc = schema.node('doc', null, [para]);
  const state = EditorState.create({ schema, doc });
  const pos = 1 + text.length;
  const match = regexp.exec(text) as RegExpMatchArray;
  const matchStart = 1 + (match.index ?? 0);
  const tr = handler(state, match, matchStart, pos);
  return tr ? state.apply(tr) : null;
}

describe('inline mark input rules', () => {
  it('turns **text** into bold and strips the delimiters', () => {
    const next = run('**hello**', BOLD_STAR_RULE, markRuleHandler(schema.marks.strong));
    expect(next?.doc.textContent).toBe('hello');
    expect(next?.doc.firstChild?.firstChild?.marks.map((m) => m.type.name)).toEqual(['strong']);
  });

  it('turns __text__ into bold', () => {
    const next = run('__hello__', BOLD_UNDERSCORE_RULE, markRuleHandler(schema.marks.strong));
    expect(next?.doc.textContent).toBe('hello');
    expect(next?.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('strong');
  });

  it('turns *text* into italic', () => {
    const next = run('*hello*', ITALIC_STAR_RULE, markRuleHandler(schema.marks.em));
    expect(next?.doc.textContent).toBe('hello');
    expect(next?.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('em');
  });

  it('turns _text_ into italic', () => {
    const next = run('_hello_', ITALIC_UNDERSCORE_RULE, markRuleHandler(schema.marks.em));
    expect(next?.doc.textContent).toBe('hello');
    expect(next?.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('em');
  });

  it('turns ~~text~~ into strikethrough', () => {
    const next = run('~~hello~~', STRIKE_RULE, markRuleHandler(schema.marks.strike));
    expect(next?.doc.textContent).toBe('hello');
    expect(next?.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('strike');
  });

  it('turns `text` into inline code', () => {
    const next = run('`hello`', CODE_RULE, markRuleHandler(schema.marks.code));
    expect(next?.doc.textContent).toBe('hello');
    expect(next?.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('code');
  });

  it('keeps a leading word and space before the delimited run', () => {
    const next = run('say **hi**', BOLD_STAR_RULE, markRuleHandler(schema.marks.strong));
    expect(next?.doc.textContent).toBe('say hi');
    const text = next?.doc.firstChild;
    // "say " stays unmarked, "hi" carries strong.
    expect(text?.textContent.startsWith('say ')).toBe(true);
  });

  it("doesn't match unclosed markdown", () => {
    const match = BOLD_STAR_RULE.exec('**hello');
    expect(match).toBeNull();
  });
});

describe('link input rule', () => {
  it('turns [text](url) into a link mark and drops the raw syntax', () => {
    const next = run(
      '[Copad](https://example.com)',
      LINK_RULE,
      linkRuleHandler(schema.marks.link)
    );
    expect(next?.doc.textContent).toBe('Copad');
    const mark = next?.doc.firstChild?.firstChild?.marks[0];
    expect(mark?.type.name).toBe('link');
    expect(mark?.attrs.href).toBe('https://example.com');
  });

  it('normalizes a bare host into an https:// link', () => {
    const next = run('[site](example.com)', LINK_RULE, linkRuleHandler(schema.marks.link));
    expect(next?.doc.firstChild?.firstChild?.marks[0]?.attrs.href).toBe('https://example.com');
  });

  it('parks the caret right after the inserted link text (not beyond it) — an unset selection biases past the insertion and, inside a table, lands in the NEXT cell', () => {
    const next = run('[hi](https://example.com)', LINK_RULE, linkRuleHandler(schema.marks.link));
    // "hi" occupies positions 1..3; the caret must sit at 3, immediately after
    // the link text, so subsequent typing continues in the same block/cell.
    expect(next?.selection.from).toBe(3);
    expect(next?.selection.empty).toBe(true);
  });

  it('rejects an invalid href and leaves the text untouched', () => {
    const next = run('[todo](justaword)', LINK_RULE, linkRuleHandler(schema.marks.link));
    expect(next).toBeNull();
  });
});

/** Runs `command` at `selPos` in `doc` and returns { handled, next, dispatched }
 *  — `next` is the resulting state if a transaction was dispatched, else null. */
function runCmd(
  command: Command,
  doc: ReturnType<typeof schema.node>,
  selPos: number,
  selEnd?: number
): { handled: boolean; next: EditorState | null; dispatched: boolean } {
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, selPos, selEnd),
  });
  let next: EditorState | null = null;
  let dispatched = false;
  const handled = command(state, (tr) => {
    dispatched = true;
    next = state.apply(tr);
  });
  return { handled, next, dispatched };
}

describe('escapeCodeBlock', () => {
  const run = (doc: ReturnType<typeof schema.node>, selPos: number, selEnd?: number) =>
    runCmd(escapeCodeBlock, doc, selPos, selEnd);

  it('exits a trailing code block (last node in the doc) into a new paragraph after it', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { handled, next, dispatched } = run(doc, 3);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.firstChild?.textContent).toBe('let x = 1');
    expect(next!.doc.lastChild?.type.name).toBe('paragraph');
    expect(next!.selection.$head.parent.type.name).toBe('paragraph');
  });

  it('inserts a new paragraph after an empty trailing code block, WITHOUT touching the code block itself (never destructive — matches Tiptap)', () => {
    const codeBlock = schema.node('code_block');
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.lastChild?.type.name).toBe('paragraph');
    expect(next!.selection.$head.parent.type.name).toBe('paragraph');
  });

  it('moves into an existing paragraph that already follows the code block, without inserting a new one', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const para = schema.node('paragraph', null, schema.text('already here'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    const { next, dispatched } = run(doc, 3);
    expect(dispatched).toBe(true);
    // No node was inserted: still exactly 2 children, and the paragraph's
    // text is untouched (a naive exitCode would insert a 3rd, empty one).
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.child(1).textContent).toBe('already here');
    expect(next!.selection.$head.parent).toBe(next!.doc.child(1));
  });

  it('moves into an existing EMPTY paragraph that follows, without converting or deleting the code block', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const para = schema.node('paragraph');
    const doc = schema.node('doc', null, [codeBlock, para]);
    const { next } = run(doc, 3);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.firstChild?.textContent).toBe('let x = 1');
    expect(next!.selection.$head.parent).toBe(next!.doc.child(1));
  });

  it('moves into an existing sibling even when the code block itself is empty (never destructive when something follows)', () => {
    const codeBlock = schema.node('code_block');
    const para = schema.node('paragraph', null, schema.text('after'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.selection.$head.parent.textContent).toBe('after');
  });

  it('lands in an adjacent code block rather than duplicating a paragraph', () => {
    const codeBlock1 = schema.node('code_block', null, schema.text('a'));
    const codeBlock2 = schema.node('code_block', null, schema.text('b'));
    const doc = schema.node('doc', null, [codeBlock1, codeBlock2]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.selection.$head.parent.type.name).toBe('code_block');
    expect(next!.selection.$head.parent).toBe(next!.doc.child(1));
  });

  it('only escapes to the enclosing container, not past it — exits a code block nested in a blockquote into a new paragraph inside the blockquote', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const blockquote = schema.node('blockquote', null, [codeBlock]);
    const doc = schema.node('doc', null, [blockquote]);
    const { next } = run(doc, 3);
    expect(next!.doc.childCount).toBe(1);
    expect(next!.doc.firstChild?.type.name).toBe('blockquote');
    expect(next!.doc.firstChild?.childCount).toBe(2);
    expect(next!.doc.firstChild?.lastChild?.type.name).toBe('paragraph');
    expect(next!.selection.$head.node(-1)).toBe(next!.doc.firstChild);
  });

  it('inserts a paragraph after an empty code block nested alone in a blockquote, without touching the code block', () => {
    const codeBlock = schema.node('code_block');
    const blockquote = schema.node('blockquote', null, [codeBlock]);
    const doc = schema.node('doc', null, [blockquote]);
    const { next } = run(doc, 2);
    expect(next!.doc.firstChild?.childCount).toBe(2);
    expect(next!.doc.firstChild?.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.firstChild?.lastChild?.type.name).toBe('paragraph');
  });

  it('moves into an existing sibling inside a blockquote instead of inserting a duplicate', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const para = schema.node('paragraph', null, schema.text('after, in quote'));
    const blockquote = schema.node('blockquote', null, [codeBlock, para]);
    const doc = schema.node('doc', null, [blockquote]);
    const { next } = run(doc, 3);
    expect(next!.doc.firstChild?.childCount).toBe(2);
    expect(next!.doc.firstChild?.lastChild?.textContent).toBe('after, in quote');
    expect(next!.selection.$head.parent).toBe(next!.doc.firstChild?.lastChild);
  });

  it('exits the same way regardless of caret position within the code block (not just at the end)', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const para = schema.node('paragraph', null, schema.text('next'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    // Position 1 = right at the very start of the code block's text.
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.selection.$head.parent.textContent).toBe('next');
  });

  it('moves past the immediate next sibling, not further, when several blocks follow', () => {
    const codeBlock = schema.node('code_block', null, schema.text('x'));
    const para1 = schema.node('paragraph', null, schema.text('first'));
    const para2 = schema.node('paragraph', null, schema.text('second'));
    const doc = schema.node('doc', null, [codeBlock, para1, para2]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(3);
    expect(next!.selection.$head.parent.textContent).toBe('first');
  });

  it("returns true (swallowing Escape) but dispatches nothing when the caret isn't in a code block", () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('hello')),
    ]);
    const { handled, dispatched } = run(doc, 1);
    expect(handled).toBe(true);
    expect(dispatched).toBe(false);
  });

  it('is a no-op on a second press once the caret already left the code block', () => {
    const codeBlock = schema.node('code_block', null, schema.text('x'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 1);
    const { dispatched } = run(next!.doc, next!.selection.head);
    expect(dispatched).toBe(false);
  });

  it('dispatches nothing for a selection spanning out of the code block into a different parent', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const para = schema.node('paragraph', null, schema.text('next'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    // from inside the code block (pos 3) to inside the paragraph (pos past it)
    const { handled, dispatched } = run(doc, 3, doc.content.size - 1);
    expect(handled).toBe(true);
    expect(dispatched).toBe(false);
  });

  it('does nothing (but still swallows) when called in dry-run mode (no dispatch) from within a code block', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const doc = schema.node('doc', null, [codeBlock]);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    expect(() => escapeCodeBlock(state, undefined)).not.toThrow();
    expect(escapeCodeBlock(state, undefined)).toBe(true);
  });
});

describe('exitCodeBlockDown', () => {
  const run = (doc: ReturnType<typeof schema.node>, selPos: number, selEnd?: number) =>
    runCmd(exitCodeBlockDown, doc, selPos, selEnd);

  it('exits a trailing code block when the caret is at its very end', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const doc = schema.node('doc', null, [codeBlock]);
    // pos 10 = right after the 9-char "let x = 1" (1 for the block start + 9).
    const { handled, next, dispatched } = run(doc, 10);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.lastChild?.type.name).toBe('paragraph');
  });

  it('returns false (native ArrowDown proceeds) when the caret is NOT at the end of the block', () => {
    const codeBlock = schema.node('code_block', null, schema.text('line one\nline two'));
    const doc = schema.node('doc', null, [codeBlock]);
    // Position inside "line one", well before the block's end.
    const { handled, dispatched } = run(doc, 5);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('moves into an existing next sibling instead of inserting a new paragraph', () => {
    const codeBlock = schema.node('code_block', null, schema.text('x'));
    const para = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    const { next } = run(doc, 2);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.selection.$head.parent.textContent).toBe('below');
  });

  it('inserts a paragraph after an empty trailing code block, WITHOUT converting/deleting the code block (ArrowDown must never be destructive)', () => {
    const codeBlock = schema.node('code_block');
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.lastChild?.type.name).toBe('paragraph');
  });

  it("returns false when the caret isn't in a code block at all", () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('hi'))]);
    const { handled, dispatched } = run(doc, 3);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('returns false for a cross-parent selection even if $head is at the end of a code block', () => {
    const codeBlock = schema.node('code_block', null, schema.text('x'));
    const para = schema.node('paragraph', null, schema.text('next'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    // anchor inside the paragraph, head at the code block's end position.
    const { handled, dispatched } = run(doc, 5, 2);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe('exitCodeBlockOnBlankLine (triple-Enter exit)', () => {
  const run = (doc: ReturnType<typeof schema.node>, selPos: number, selEnd?: number) =>
    runCmd(exitCodeBlockOnBlankLine, doc, selPos, selEnd);

  it('does NOT fire on a single blank line (real code often has intentional blank lines)', () => {
    const codeBlock = schema.node('code_block', null, schema.text('foo\n'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { handled, dispatched } = run(doc, 5);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('fires on two consecutive blank lines and trims them, keeping real content intact', () => {
    const codeBlock = schema.node('code_block', null, schema.text('foo\n\n'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { handled, next, dispatched } = run(doc, 6);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.firstChild?.textContent).toBe('foo');
    expect(next!.doc.lastChild?.type.name).toBe('paragraph');
  });

  it('a code block that was only blank lines is trimmed back to empty and left in place — not deleted (matches Tiptap: only Backspace/the Mod-Alt-c toggle remove a code block)', () => {
    const codeBlock = schema.node('code_block', null, schema.text('\n\n'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 3);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.firstChild?.content.size).toBe(0);
    expect(next!.doc.lastChild?.type.name).toBe('paragraph');
    expect(next!.selection.$head.parent.type.name).toBe('paragraph');
  });

  it('moves into an existing next sibling after trimming, without inserting a duplicate paragraph', () => {
    const codeBlock = schema.node('code_block', null, schema.text('foo\n\n'));
    const para = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    const { next } = run(doc, 6);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.textContent).toBe('foo');
    expect(next!.selection.$head.parent.textContent).toBe('below');
  });

  it('requires the blank lines to be at the very end of the block, not just anywhere before the caret', () => {
    // Two blank lines mid-block, then more text after the caret — the caret
    // itself isn't at the block's end, so this must not fire.
    const codeBlock = schema.node('code_block', null, schema.text('a\n\nb'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { handled, dispatched } = run(doc, 4); // right after "a\n\n"
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it("returns false when the caret isn't in a code block", () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('a\n\n'))]);
    const { handled, dispatched } = run(doc, 4);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('is idempotent — does not refire once the exit already trimmed the block back to single-newline-free content', () => {
    const codeBlock = schema.node('code_block', null, schema.text('foo\n\n'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 6);
    // The code block is now back to just "foo" (no trailing blank lines) —
    // a second call at the current selection must not fire again.
    const { handled, dispatched } = run(next!.doc, next!.selection.head);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe('clearEmptyCodeBlockBackward', () => {
  const run = (doc: ReturnType<typeof schema.node>, selPos: number, selEnd?: number) =>
    runCmd(clearEmptyCodeBlockBackward, doc, selPos, selEnd);

  it('converts a sole empty code block into a paragraph on Backspace at its start', () => {
    const codeBlock = schema.node('code_block');
    const doc = schema.node('doc', null, [codeBlock]);
    const { handled, next, dispatched } = run(doc, 1);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(1);
    expect(next!.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('converts an empty code block that is NOT the last node, leaving the rest of the doc untouched', () => {
    const codeBlock = schema.node('code_block');
    const para = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('paragraph');
    expect(next!.doc.lastChild?.textContent).toBe('below');
  });

  it('returns false (normal character-deleting Backspace proceeds) when the code block has content, even at its start', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { handled, dispatched } = run(doc, 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it("returns false when the caret is empty but NOT at the block's start, even if the block is empty (there's nothing before the caret in an empty block anyway, but guard the invariant explicitly)", () => {
    const codeBlock = schema.node('code_block');
    const doc = schema.node('doc', null, [codeBlock]);
    // pos 1 is the only valid cursor position in a truly empty code block;
    // simulate "not at start" via a non-empty block's start-of-second-line.
    const nonEmptyBlock = schema.node('code_block', null, schema.text('a\nb'));
    const doc2 = schema.node('doc', null, [nonEmptyBlock]);
    const { handled: h1 } = run(doc, 1);
    expect(h1).toBe(true); // sanity: does fire for the genuinely empty case
    const { handled: h2, dispatched: d2 } = run(doc2, 3); // mid-content, not start
    expect(h2).toBe(false);
    expect(d2).toBe(false);
  });

  it("returns false when the caret isn't in a code block", () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')]);
    const { handled, dispatched } = run(doc, 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('returns false for a cross-parent selection', () => {
    const codeBlock = schema.node('code_block');
    const para = schema.node('paragraph', null, schema.text('x'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    const { handled, dispatched } = run(doc, 4, 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

/**
 * The real key resolution order buildPlugins wires for 'Enter': the custom
 * keymap's chain (list-item splitting, code-block exit) first, falling
 * through — since none of those apply to a plain paragraph — to baseKeymap's
 * own Enter (`newlineInCode`/`createParagraphNear`/`liftEmptyBlock`/
 * `splitBlock`). Cells hold real block content now (see schema.ts), so
 * there's no more `exitTableAtBoundary`/`preventEnterInTableCell` special
 * case in between — Enter inside a cell reaches `splitBlock` exactly like
 * Enter in a plain top-level paragraph does.
 */
const enterCommand: Command = chainCommands(
  exitCodeBlockOnBlankLine,
  splitListItem(schema.nodes.list_item),
  splitListItem(schema.nodes.task_item, { checked: false }),
  baseKeymap['Enter']
);

describe('Enter inside a table cell (real block content, no more table-escape special case)', () => {
  it('splits a paragraph within a cell into two paragraphs, staying inside the same cell', () => {
    const types = tableNodeTypes(schema);
    const cell = types.header_cell.create(null, [schema.nodes.paragraph.create(null, schema.text('hello'))]);
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    // Split between "hel" and "lo". cellContentPos already resolves to the
    // real start of the paragraph's text (see its doc comment).
    const pos = cellContentPos(doc, 'hello') + 3;
    const { handled, dispatched, next } = runCmd(enterCommand, doc, pos);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    const restoredCell = next!.doc.firstChild?.firstChild?.firstChild;
    expect(restoredCell?.childCount).toBe(2); // two paragraphs now, same cell
    expect(restoredCell?.child(0).type.name).toBe('paragraph');
    expect(restoredCell?.child(0).textContent).toBe('hel');
    expect(restoredCell?.child(1).type.name).toBe('paragraph');
    expect(restoredCell?.child(1).textContent).toBe('lo');
    // Still one row, one cell — the table itself wasn't touched.
    expect(next!.doc.firstChild?.childCount).toBe(1);
    expect(next!.doc.firstChild?.firstChild?.childCount).toBe(1);
  });

  it('at the very start of a cell\'s content, adds an empty paragraph before it, staying inside the cell (not escaping the table — that\'s the Arrow keys\' job now)', () => {
    const types = tableNodeTypes(schema);
    const cell = types.header_cell.create(null, [schema.nodes.paragraph.create(null, schema.text('hello'))]);
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    const pos = cellContentPos(doc, 'hello'); // real start of the paragraph's text
    const { handled, dispatched, next } = runCmd(enterCommand, doc, pos);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    const restoredCell = next!.doc.firstChild?.firstChild?.firstChild;
    expect(restoredCell?.childCount).toBe(2);
    expect(restoredCell?.child(0).type.name).toBe('paragraph');
    expect(restoredCell?.child(0).textContent).toBe(''); // fresh empty paragraph
    expect(restoredCell?.child(1).textContent).toBe('hello'); // original content, untouched
    // Still one row, one cell — no escape out of the table.
    expect(next!.doc.childCount).toBe(1);
    expect(next!.doc.firstChild?.type.name).toBe('table');
  });
});

describe('backspaceAtTableStart', () => {
  const bs = backspaceAtTableStart();

  it('deletes an empty paragraph directly above the table', () => {
    const empty = schema.node('paragraph');
    const doc = schema.node('doc', null, [empty, oneCellTable()]);
    // End of the empty paragraph, then into table/row/cell — snapped to the
    // real reachable position inside the cell's own (empty) paragraph, same
    // as cellContentRange/cellContentPos (see their doc comments).
    const cellStart = TextSelection.near(doc.resolve(empty.nodeSize + 3), 1).from;
    const { handled, dispatched, next } = runCmd(bs, doc, cellStart);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(1); // the empty paragraph is gone
    expect(next!.doc.firstChild?.type.name).toBe('table');
  });

  it('moves the caret to the end of a non-empty paragraph above the table, without deleting or merging it', () => {
    const before = schema.node('paragraph', null, schema.text('above'));
    const doc = schema.node('doc', null, [before, oneCellTable()]);
    const cellStart = TextSelection.near(doc.resolve(before.nodeSize + 3), 1).from;
    const { handled, dispatched, next } = runCmd(bs, doc, cellStart);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2); // nothing deleted
    expect(next!.selection.$from.parent.textContent).toBe('above');
    expect(next!.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('returns false when nothing precedes the table at all', () => {
    const doc = schema.node('doc', null, [oneCellTable()]);
    const { handled, dispatched } = runCmd(bs, doc, 3);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('does not fire from a non-start position inside the cell', () => {
    const empty = schema.node('paragraph');
    const cell = tableNodeTypes(schema).header_cell.create(null, [
      schema.nodes.paragraph.create(null, schema.text('ab')),
    ]);
    const doc = schema.node('doc', null, [
      empty,
      tableNodeTypes(schema).table.create(null, [tableNodeTypes(schema).row.create(null, [cell])]),
    ]);
    // Between "a" and "b" — cellContentPos already resolves to the real
    // start of the cell's text, so "+1" lands one character in, not at
    // the true start.
    const midCellPos = cellContentPos(doc, 'ab') + 1;
    const { handled, dispatched } = runCmd(bs, doc, midCellPos);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('returns false outside a table entirely', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('x'))]);
    const { handled, dispatched } = runCmd(bs, doc, 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('fires from ANY column of the top row, not just the first cell — same generalization as exitTableAtBoundary/tableArrowVertical', () => {
    const before = schema.node('paragraph', null, schema.text('above'));
    const doc = schema.node('doc', null, [before, threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(bs, doc, cellContentPos(doc, 'B1'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2); // nothing deleted, no merge
    expect(next!.selection.$from.parent.textContent).toBe('above');
  });

  it('does not fire from a row other than the top row', () => {
    const before = schema.node('paragraph', null, schema.text('above'));
    const doc = schema.node('doc', null, [before, threeByThreeTable()]);
    const { handled, dispatched } = runCmd(bs, doc, cellContentPos(doc, 'B2'));
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe('deleteAtTableEnd (forward-Delete mirror of backspaceAtTableStart)', () => {
  const del = deleteAtTableEnd();

  it('deletes an empty paragraph directly after the table', () => {
    const empty = schema.node('paragraph');
    const doc = schema.node('doc', null, [oneCellTable(), empty]);
    const { handled, dispatched, next } = runCmd(del, doc, cellContentEnd(doc, ''));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(1); // the empty paragraph is gone
    expect(next!.doc.firstChild?.type.name).toBe('table');
  });

  it('moves the caret to the start of a non-empty paragraph after the table, without deleting or merging it', () => {
    const after = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [oneCellTable(), after]);
    const { handled, dispatched, next } = runCmd(del, doc, cellContentEnd(doc, ''));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2); // nothing deleted
    expect(next!.selection.$from.parent.textContent).toBe('below');
    expect(next!.selection.$from.parent.type.name).toBe('paragraph');
    expect(next!.selection.$from.parentOffset).toBe(0);
  });

  it('returns false when nothing follows the table at all', () => {
    const doc = schema.node('doc', null, [oneCellTable()]);
    const { handled, dispatched } = runCmd(del, doc, cellContentEnd(doc, ''));
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('does not fire from a non-end position inside the cell', () => {
    const after = schema.node('paragraph');
    const cell = tableNodeTypes(schema).header_cell.create(null, [
      schema.nodes.paragraph.create(null, schema.text('ab')),
    ]);
    const doc = schema.node('doc', null, [
      tableNodeTypes(schema).table.create(null, [tableNodeTypes(schema).row.create(null, [cell])]),
      after,
    ]);
    // Between "a" and "b", not the cell's true content end. cellContentPos
    // already resolves to the real start of the text (before "a").
    const midCellPos = cellContentPos(doc, 'ab') + 1;
    const { handled, dispatched } = runCmd(del, doc, midCellPos);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('fires from ANY column of the bottom row, not just the last cell', () => {
    const after = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [threeByThreeTable(), after]);
    const { handled, dispatched, next } = runCmd(del, doc, cellContentEnd(doc, 'B3'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.selection.$from.parent.textContent).toBe('below');
  });

  it('does not fire from a row other than the bottom row', () => {
    const after = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [threeByThreeTable(), after]);
    const { handled, dispatched } = runCmd(del, doc, cellContentEnd(doc, 'B2'));
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('returns false outside a table entirely', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('x'))]);
    const { handled, dispatched } = runCmd(del, doc, 2);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

/** A 3×3 table (one header row + two body rows) with a distinct one-letter
 *  label per cell — A1/B1/C1 (header row), A2/B2/C2, A3/B3/C3 — so tests can
 *  tell exactly which cell the caret/selection ended up in. Each cell's text
 *  lives inside a wrapping paragraph — cells now hold real block content
 *  (`block+`, see schema.ts), not bare inline content. */
function threeByThreeTable() {
  const types = tableNodeTypes(schema);
  const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
  const headerRow = types.row.create(null, [
    types.header_cell.create(null, [p('A1')]),
    types.header_cell.create(null, [p('B1')]),
    types.header_cell.create(null, [p('C1')]),
  ]);
  const row2 = types.row.create(null, [
    types.cell.create(null, [p('A2')]),
    types.cell.create(null, [p('B2')]),
    types.cell.create(null, [p('C2')]),
  ]);
  const row3 = types.row.create(null, [
    types.cell.create(null, [p('A3')]),
    types.cell.create(null, [p('B3')]),
    types.cell.create(null, [p('C3')]),
  ]);
  return types.table.create(null, [headerRow, row2, row3]);
}

/** The position where a real caret actually rests at the start of a cell's
 *  content, for the cell whose text is exactly `label` — matches
 *  {@link cellContentRange}'s (plugins.ts) `start`. That's one depth level
 *  *inside* the cell's wrapping paragraph (`TextSelection.near` from the
 *  cell's own structural edge, biased forward), not the cell's raw
 *  structural edge itself: a real DOM caret can never rest at a non-inline
 *  position (see `cellContentRange`'s doc comment — this is exactly the bug
 *  that let a fresh table trap the caret with no ArrowUp/ArrowDown escape). */
function cellContentPos(doc: ReturnType<typeof schema.node>, label: string): number {
  let pos = -1;
  doc.descendants((node, nodePos) => {
    if ((node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header) && node.textContent === label) {
      pos = nodePos + 1;
    }
  });
  if (pos === -1) throw new Error(`cell "${label}" not found`);
  return TextSelection.near(doc.resolve(pos), 1).from;
}

/** Mirror of {@link cellContentPos} for the *end* of a cell's content span —
 *  matches {@link cellContentRange}'s `end`: the real caret-reachable
 *  position (`TextSelection.near`, biased backward) rather than the cell's
 *  raw structural edge. Computed by walking the actual cell node's
 *  `content.size` rather than a hardcoded text-length offset, so it stays
 *  correct regardless of how many characters/blocks the cell holds. */
function cellContentEnd(doc: ReturnType<typeof schema.node>, label: string): number {
  let pos = -1;
  doc.descendants((node, nodePos) => {
    if ((node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header) && node.textContent === label) {
      pos = nodePos + 1 + node.content.size;
    }
  });
  if (pos === -1) throw new Error(`cell "${label}" not found`);
  return TextSelection.near(doc.resolve(pos), -1).from;
}

describe('tableArrowVertical', () => {
  const up = tableArrowVertical(-1);
  const down = tableArrowVertical(1);

  it('ArrowUp moves to the same-column cell in the row above (not the reading-order previous cell)', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(up, doc, cellContentPos(doc, 'B2'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.selection.$from.parent.textContent).toBe('B1');
  });

  it('ArrowDown moves to the same-column cell in the row below', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(down, doc, cellContentEnd(doc, 'B2'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.selection.$from.parent.textContent).toBe('B3');
  });

  it('ArrowUp from any column of the top row moves into an existing paragraph above, not just the first column', () => {
    const before = schema.node('paragraph', null, schema.text('above'));
    const doc = schema.node('doc', null, [before, threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(up, doc, cellContentPos(doc, 'B1'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2); // nothing inserted
    expect(next!.selection.$from.parent.textContent).toBe('above');
  });

  it('ArrowDown from any column of the bottom row moves into an existing paragraph below', () => {
    const after = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [threeByThreeTable(), after]);
    const { handled, dispatched, next } = runCmd(down, doc, cellContentEnd(doc, 'B3'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.selection.$from.parent.textContent).toBe('below');
  });

  it('ArrowUp from the top row swallows the key (handled, but nothing dispatched) when the table opens the doc — Arrow keys are pure navigation, never create content (unlike Enter), and must not fall through to prosemirror-tables\' own broken vertical-arrow handler', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(up, doc, cellContentPos(doc, 'B1'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(false);
    expect(next).toBeNull();
  });

  it('ArrowDown from the bottom row (NOT the rightmost column) swallows the key rather than falling through to a worse handler when the table closes the doc', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(down, doc, cellContentEnd(doc, 'B3'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(false);
    expect(next).toBeNull();
  });

  it('returns false outside a table entirely', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('x'))]);
    const { handled, dispatched } = runCmd(up, doc, 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('preserves the column when the "neighbour" at a boundary is another table, not a paragraph (two tables with nothing between them)', () => {
    const types = tableNodeTypes(schema);
    const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
    const secondTable = types.table.create(null, [
      types.row.create(null, [
        types.header_cell.create(null, [p('X1')]),
        types.header_cell.create(null, [p('Y1')]),
        types.header_cell.create(null, [p('Z1')]),
      ]),
    ]);
    const doc = schema.node('doc', null, [threeByThreeTable(), secondTable]);
    // Leave from B3 (column index 1, bottom row of the first table).
    const { handled, dispatched, next } = runCmd(down, doc, cellContentEnd(doc, 'B3'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    // Must land in the second table's column-1 cell (Y1), not silently reset to column 0 (X1).
    expect(next!.selection.$from.parent.textContent).toBe('Y1');
  });

  it('ArrowDown from the FIRST of two paragraphs in one cell moves to the second paragraph within the same cell (native handling), not down to the row below', () => {
    const types = tableNodeTypes(schema);
    const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
    const topCell = types.header_cell.create(null, [p('one'), p('two')]);
    const bottomCell = types.cell.create(null, [p('below')]);
    const doc = schema.node('doc', null, [
      types.table.create(null, [
        types.row.create(null, [topCell]),
        types.row.create(null, [bottomCell]),
      ]),
    ]);
    let endOfOne = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'one') endOfOne = pos + node.nodeSize;
    });
    const { handled, dispatched } = runCmd(down, doc, endOfOne);
    // Not at the cell's true content end (there's a second paragraph after
    // this one) — falls through to ordinary vertical caret movement, which
    // already handles moving between blocks within one cell.
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('ArrowDown from the LAST paragraph of a two-paragraph cell escapes to the row below (only once truly at the cell\'s end)', () => {
    const types = tableNodeTypes(schema);
    const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
    const topCell = types.header_cell.create(null, [p('one'), p('two')]);
    const bottomCell = types.cell.create(null, [p('below')]);
    const doc = schema.node('doc', null, [
      types.table.create(null, [
        types.row.create(null, [topCell]),
        types.row.create(null, [bottomCell]),
      ]),
    ]);
    let endOfTwo = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'two') endOfTwo = pos + node.nodeSize; // real reachable end: right after "two", matching cellContentRange.end
    });
    const { handled, dispatched, next } = runCmd(down, doc, endOfTwo);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.selection.$from.parent.textContent).toBe('below');
  });
});

describe('tableArrowHorizontal', () => {
  const left = tableArrowHorizontal(-1);
  const right = tableArrowHorizontal(1);

  it('returns false in the middle of a row — ordinary cell-to-cell movement is left to native caret handling', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    // End of B2's content ("B2"), a non-boundary cell — not the table's outer corner.
    const { handled, dispatched } = runCmd(right, doc, cellContentEnd(doc, 'B2'));
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('returns false when not at the end/start of the cell\'s own content, even in a corner cell', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    // Between "C" and "3" of C3's content (the bottom-right corner cell), not
    // yet at its end. cellContentPos already resolves to the real start.
    const { handled, dispatched } = runCmd(right, doc, cellContentPos(doc, 'C3') + 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('ArrowRight swallows the key at the end of the last cell when the table closes the doc — no neighbour to escape into, and never wraps back to the first cell', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(right, doc, cellContentEnd(doc, 'C3'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(false);
    expect(next).toBeNull();
  });

  it('ArrowLeft swallows the key at the start of the first cell when the table opens the doc', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(left, doc, cellContentPos(doc, 'A1'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(false);
    expect(next).toBeNull();
  });

  it('ArrowRight at the end of the last cell escapes into an existing paragraph after the table', () => {
    const after = schema.node('paragraph', null, schema.text('after'));
    const doc = schema.node('doc', null, [threeByThreeTable(), after]);
    const { handled, dispatched, next } = runCmd(right, doc, cellContentEnd(doc, 'C3'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.selection.$from.parent.textContent).toBe('after');
  });

  it('ArrowLeft at the start of the first cell escapes into an existing paragraph before the table', () => {
    const before = schema.node('paragraph', null, schema.text('before'));
    const doc = schema.node('doc', null, [before, threeByThreeTable()]);
    const { handled, dispatched, next } = runCmd(left, doc, cellContentPos(doc, 'A1'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.selection.$from.parent.textContent).toBe('before');
  });

  it('returns false outside a table entirely', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('x'))]);
    const { handled, dispatched } = runCmd(right, doc, 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('ArrowRight at the end of the FIRST of two paragraphs in one cell falls through to native handling (moves to the second paragraph), even in the table\'s bottom-right corner cell', () => {
    const types = tableNodeTypes(schema);
    const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
    const cell = types.header_cell.create(null, [p('one'), p('two')]);
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    let endOfOne = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'one') endOfOne = pos + node.nodeSize;
    });
    const { handled, dispatched } = runCmd(right, doc, endOfOne);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('ArrowRight at the end of the SECOND (last) paragraph of a two-paragraph cell escapes the table (truly at the cell\'s content end)', () => {
    const types = tableNodeTypes(schema);
    const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
    const cell = types.header_cell.create(null, [p('one'), p('two')]);
    const after = schema.node('paragraph', null, schema.text('after'));
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])]), after]);
    let endOfTwo = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'two') endOfTwo = pos + node.nodeSize; // real reachable end: right after "two", matching cellContentRange.end
    });
    const { handled, dispatched, next } = runCmd(right, doc, endOfTwo);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.selection.$from.parent.textContent).toBe('after');
  });
});

describe('tableGoalColumnKey (remembered column across an escape/re-entry round trip)', () => {
  function stateWithGoalColumnPlugin(doc: ReturnType<typeof schema.node>, pos: number): EditorState {
    return EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, pos),
      plugins: [tableGoalColumnPlugin()],
    });
  }

  it('records the column of the cell just left when moving to another cell', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const state = stateWithGoalColumnPlugin(doc, cellContentEnd(doc, 'C2')); // column index 2
    let next: EditorState | null = null;
    tableArrowVertical(1)(state, (tr) => {
      next = state.apply(tr);
    });
    expect(tableGoalColumnKey.getState(next!)).toBe(2);
  });

  it('records the column being left when escaping the table entirely', () => {
    const after = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [threeByThreeTable(), after]);
    const state = stateWithGoalColumnPlugin(doc, cellContentEnd(doc, 'A3')); // column index 0, bottom row
    let next: EditorState | null = null;
    tableArrowVertical(1)(state, (tr) => {
      next = state.apply(tr);
    });
    expect(tableGoalColumnKey.getState(next!)).toBe(0);
  });

  it('is cleared by an unrelated selection change (e.g. a click, or any transaction not from these commands)', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    let state = stateWithGoalColumnPlugin(doc, cellContentEnd(doc, 'C2'));
    tableArrowVertical(1)(state, (tr) => {
      state = state.apply(tr);
    });
    expect(tableGoalColumnKey.getState(state)).toBe(2);

    // An ordinary selection-changing transaction (a click, arrow-left, etc.)
    // with no meta of its own must clear the remembered column.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    expect(tableGoalColumnKey.getState(state)).toBeNull();
  });

  it('is left untouched by a transaction with no selection change at all', () => {
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    let state = stateWithGoalColumnPlugin(doc, cellContentEnd(doc, 'C2'));
    tableArrowVertical(1)(state, (tr) => {
      state = state.apply(tr);
    });
    expect(tableGoalColumnKey.getState(state)).toBe(2);

    // A transaction that doesn't touch the selection (e.g. a stray meta-only
    // transaction) shouldn't reset the remembered column.
    state = state.apply(state.tr.setMeta('unrelated', true));
    expect(tableGoalColumnKey.getState(state)).toBe(2);
  });
});

describe('tableShiftArrow', () => {
  function stateAt(doc: ReturnType<typeof schema.node>, pos: number): EditorState {
    return EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
  }

  it('Shift-ArrowDown from the cell edge starts a CellSelection covering the cell and the one below it', () => {
    const cmd = tableShiftArrow('vert', 1);
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    // Caret at the cell's content *end* (dir 1): only there does Shift-Arrow
    // cross into the next cell — mid-content it extends the text selection,
    // same gate as tableArrowVertical/Horizontal.
    const state = stateAt(doc, cellContentEnd(doc, 'B2'));
    let next: EditorState | null = null;
    const handled = cmd(state, (tr) => {
      next = state.apply(tr);
    });
    expect(handled).toBe(true);
    const sel = next!.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    const rect = selectedRect(next!);
    expect(rect.bottom - rect.top).toBe(2); // spans 2 rows
    expect(rect.right - rect.left).toBe(1); // spans 1 column
  });

  it('Shift-ArrowRight from the cell edge starts a CellSelection covering the cell and the one to its right', () => {
    const cmd = tableShiftArrow('horiz', 1);
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const state = stateAt(doc, cellContentEnd(doc, 'B2'));
    let next: EditorState | null = null;
    const handled = cmd(state, (tr) => {
      next = state.apply(tr);
    });
    expect(handled).toBe(true);
    const rect = selectedRect(next!);
    expect(rect.right - rect.left).toBe(2); // spans 2 columns
    expect(rect.bottom - rect.top).toBe(1); // spans 1 row
  });

  it('does NOT hijack Shift-Arrow into a CellSelection from mid-cell content', () => {
    // Regression: a bare caret mid-content used to jump straight to a
    // whole-cell selection, making it impossible to extend an ordinary text
    // selection within a multi-block cell. Now Shift-Arrow only crosses cells
    // at the cell's own content edge — anywhere else it returns false so the
    // browser extends the text selection natively inside the cell.
    const right = tableShiftArrow('horiz', 1);
    const down = tableShiftArrow('vert', 1);
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    // Start of "B2" — not the content end, so neither axis should fire.
    const state = stateAt(doc, cellContentPos(doc, 'B2'));
    for (const cmd of [right, down]) {
      let dispatched = false;
      const handled = cmd(state, () => {
        dispatched = true;
      });
      expect(handled).toBe(false);
      expect(dispatched).toBe(false);
    }
  });

  it('extends an existing CellSelection further in the given axis rather than restarting it', () => {
    const cmd = tableShiftArrow('vert', 1);
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    // CellSelection.create wants a position pointing AT the cell itself
    // (resolve(pos).nodeAfter === the cell) — one depth level shallower than
    // cellContentPos's real-caret-position, hence "- 2" here rather than "- 1".
    const anchorPos = cellContentPos(doc, 'B1');
    const headPos = cellContentPos(doc, 'B2');
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(CellSelection.create(doc, anchorPos - 2, headPos - 2)));

    let next: EditorState | null = null;
    const handled = cmd(state, (tr) => {
      next = state.apply(tr);
    });
    expect(handled).toBe(true);
    const rect = selectedRect(next!);
    expect(rect.bottom - rect.top).toBe(3); // now spans all 3 rows (B1, B2, B3)
  });

  it('returns false at the table edge (no further cell in that axis/direction)', () => {
    const cmd = tableShiftArrow('vert', -1);
    const doc = schema.node('doc', null, [threeByThreeTable()]);
    const state = stateAt(doc, cellContentPos(doc, 'B1'));
    let dispatched = false;
    const handled = cmd(state, () => {
      dispatched = true;
    });
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('returns false outside a table entirely', () => {
    const cmd = tableShiftArrow('vert', 1);
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('x'))]);
    const state = stateAt(doc, 1);
    let dispatched = false;
    const handled = cmd(state, () => {
      dispatched = true;
    });
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe('tabAddsRowAtEnd', () => {
  const tab = tabAddsRowAtEnd();

  function oneCellTableWithText(text: string) {
    const types = tableNodeTypes(schema);
    return types.table.create(null, [
      types.row.create(null, [
        types.header_cell.create(null, [schema.nodes.paragraph.create(null, schema.text(text))]),
      ]),
    ]);
  }

  it('adds a new row and moves into its first cell, from the last cell of a 1×1 table with content', () => {
    const doc = schema.node('doc', null, [oneCellTableWithText('hi')]);
    const { handled, dispatched, next } = runCmd(tab, doc, cellContentEnd(doc, 'hi'));
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.firstChild?.childCount).toBe(2); // grew from 1 row to 2
    expect(next!.selection.$from.parent.type.name).toBe('paragraph');
    // The new row is the caret's ancestor row, and it's the table's last child.
    const table = next!.doc.firstChild!;
    const row = next!.selection.$from.node(next!.selection.$from.depth - 2); // paragraph -> cell -> row
    expect(row).toBe(table.lastChild);
  });

  it('swallows Tab without growing the table when the current last row is entirely empty — an empty row is already available to type into, so growing further would just pile up more empty rows on a stray Tab press. Still handled (not falling through to the browser default, which would tab focus out of the editor entirely)', () => {
    const doc = schema.node('doc', null, [oneCellTable()]);
    const { handled, dispatched, next } = runCmd(tab, doc, cellContentEnd(doc, ''));
    expect(handled).toBe(true);
    expect(dispatched).toBe(false);
    expect(next).toBeNull();
  });

  it('does not fire from the last cell of a non-last row (goToNextCell already has somewhere to go)', () => {
    const types = tableNodeTypes(schema);
    const firstRow = types.row.create(null, [
      types.header_cell.create(null, [schema.nodes.paragraph.create(null, schema.text('x'))]),
    ]);
    const secondRow = types.row.create(null, [types.cell.createAndFill()!]);
    const doc = schema.node('doc', null, [types.table.create(null, [firstRow, secondRow])]);
    const { handled, dispatched } = runCmd(tab, doc, cellContentEnd(doc, 'x')); // end of the first (non-last) row's only cell
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('returns false outside a table entirely', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('x'))]);
    const { handled, dispatched } = runCmd(tab, doc, 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe('structural table commands never merge into a prior undo step', () => {
  /** A state with a stand-in yUndoPlugin registered at the real y-prosemirror
   *  `yUndoPluginKey` — enough for `getState()` to find it and read a fake
   *  `undoManager.stopCapturing`, without spinning up a real Y.Doc/sync. */
  function stateWithFakeUndoManager(
    doc: ReturnType<typeof schema.node>,
    pos: number,
    stopCapturing: () => void
  ): EditorState {
    const fakeUndoPlugin = new Plugin({
      key: yUndoPluginKey,
      state: {
        init: () => ({ undoManager: { stopCapturing }, prevSel: null, hasUndoOps: false, hasRedoOps: false }),
        apply: (_tr, value) => value,
      },
    });
    return EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, pos),
      plugins: [fakeUndoPlugin],
    });
  }

  it('calls stopCapturing on the yUndoPlugin UndoManager before dispatching addRowAfter', () => {
    let calls = 0;
    const doc = schema.node('doc', null, [oneCellTable()]);
    const state = stateWithFakeUndoManager(doc, 3, () => { calls += 1; });
    let dispatched = false;
    const handled = addRowAfter(state, () => { dispatched = true; });
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(calls).toBe(1);
  });

  it('does not call stopCapturing on a dry run (no dispatch)', () => {
    let calls = 0;
    const doc = schema.node('doc', null, [oneCellTable()]);
    const state = stateWithFakeUndoManager(doc, 3, () => { calls += 1; });
    const handled = addRowAfter(state, undefined);
    expect(handled).toBe(true);
    expect(calls).toBe(0);
  });

  it('is a safe no-op when no yUndoPlugin is installed (e.g. outside a real collab session)', () => {
    const doc = schema.node('doc', null, [oneCellTable()]);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    let dispatched = false;
    expect(() => addRowAfter(state, () => { dispatched = true; })).not.toThrow();
    expect(dispatched).toBe(true);
  });
});

describe('insertHardBreak', () => {
  it('inserts a hard_break node at the caret in a plain paragraph', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('hi'))]);
    const { handled, dispatched, next } = runCmd(insertHardBreak, doc, 2); // between "h" and "i"
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.firstChild?.childCount).toBe(3); // "h", hard_break, "i"
    expect(next!.doc.firstChild?.child(1).type.name).toBe('hard_break');
  });

  it('inserts a hard_break inside a table cell (still valid — hard_break is inline content of the cell\'s wrapping paragraph, see schema.ts)', () => {
    const types = tableNodeTypes(schema);
    const cell = types.header_cell.create(null, [schema.nodes.paragraph.create(null, schema.text('ab'))]);
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    const { handled, dispatched, next } = runCmd(insertHardBreak, doc, cellContentPos(doc, 'ab') + 1); // between "a" and "b"
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    const restoredParagraph = next!.doc.firstChild?.firstChild?.firstChild?.firstChild;
    expect(restoredParagraph?.type.name).toBe('paragraph');
    expect(restoredParagraph?.childCount).toBe(3);
    expect(restoredParagraph?.child(1).type.name).toBe('hard_break');
  });

  it('returns false inside a code block (falls through to native newline-in-<pre>)', () => {
    const doc = schema.node('doc', null, [schema.node('code_block', null, schema.text('ab'))]);
    const { handled, dispatched } = runCmd(insertHardBreak, doc, 2);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe('insertTabCharacter / removeTabCharacterBefore', () => {
  it('inserts a literal tab character at the caret — Tab must never fall through to the browser default and escape the editor', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('hi'))]);
    const { handled, dispatched, next } = runCmd(insertTabCharacter, doc, 2); // between "h" and "i"
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.textContent).toBe('h\ti');
  });

  it('always returns true, even with an empty document (nothing to insert into would still be handled)', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')]);
    const { handled, dispatched } = runCmd(insertTabCharacter, doc, 1);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
  });

  it('removeTabCharacterBefore deletes a tab immediately before the caret', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('h\ti'))]);
    const { handled, dispatched, next } = runCmd(removeTabCharacterBefore, doc, 3); // right after the tab
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.textContent).toBe('hi');
  });

  it('removeTabCharacterBefore swallows the key (handled, but nothing dispatched) when there is no tab to remove — never falls through to the browser\'s reverse-tab-order default', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('hi'))]);
    const { handled, dispatched, next } = runCmd(removeTabCharacterBefore, doc, 2);
    expect(handled).toBe(true);
    expect(dispatched).toBe(false);
    expect(next).toBeNull();
  });
});

describe('toggleBlockType', () => {
  const toggle: Command = toggleBlockType(schema.nodes.code_block, schema.nodes.paragraph);
  const run = (doc: ReturnType<typeof schema.node>, selPos: number, selEnd?: number) =>
    runCmd(toggle, doc, selPos, selEnd);

  it('turns a paragraph into a code block', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('let x = 1')),
    ]);
    const { next } = run(doc, 3);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.firstChild?.textContent).toBe('let x = 1');
  });

  it('turns a code block back into a paragraph when invoked from inside one (the toggle)', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', null, schema.text('let x = 1')),
    ]);
    const { next } = run(doc, 3);
    expect(next!.doc.firstChild?.type.name).toBe('paragraph');
    expect(next!.doc.firstChild?.textContent).toBe('let x = 1');
  });

  it('round-trips: toggling twice returns to a code block', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', null, schema.text('x')),
    ]);
    const { next: once } = run(doc, 2);
    expect(once!.doc.firstChild?.type.name).toBe('paragraph');
    const { next: twice } = run(once!.doc, 2);
    expect(twice!.doc.firstChild?.type.name).toBe('code_block');
    expect(twice!.doc.firstChild?.textContent).toBe('x');
  });

  it('does not toggle off when the selection extends beyond the code block', () => {
    const codeBlock = schema.node('code_block', null, schema.text('x'));
    const para = schema.node('paragraph', null, schema.text('y'));
    const doc = schema.node('doc', null, [codeBlock, para]);
    // Selection from inside the code block to inside the paragraph — not
    // "purely inside" the code block, so this must behave as "turn into
    // code block" (setType), not the toggle-off branch.
    const { next } = run(doc, 2, 5);
    expect(next!.doc.firstChild?.type.name).toBe('code_block');
    expect(next!.doc.lastChild?.type.name).toBe('code_block');
  });
});

describe('checklist input rule', () => {
  it('matches bare [] , [ ] and [x] triggers', () => {
    expect(CHECKLIST_RULE.test('[] ')).toBe(true);
    expect(CHECKLIST_RULE.test('[ ] ')).toBe(true);
    expect(CHECKLIST_RULE.test('[x] ')).toBe(true);
    expect(CHECKLIST_RULE.test('[X] ')).toBe(true);
  });

  it("doesn't match the GFM dash-prefixed form (the bullet rule owns '- ')", () => {
    expect(CHECKLIST_RULE.test('- [ ] ')).toBe(false);
  });

  it('wraps a plain paragraph into a task_list/task_item', () => {
    // The paragraph holds only the trigger text — matching real typing: the
    // rule fires the instant "[x] " is complete, before any further text.
    const next = run('[x] ', CHECKLIST_RULE, checklistRuleHandler(schema));
    expect(next?.doc.firstChild?.type.name).toBe('task_list');
    const item = next?.doc.firstChild?.firstChild;
    expect(item?.type.name).toBe('task_item');
    expect(item?.attrs.checked).toBe(true);
    expect(item?.textContent).toBe('');
  });

  it('unchecked bracket wraps with checked: false', () => {
    const next = run('[ ] ', CHECKLIST_RULE, checklistRuleHandler(schema));
    expect(next?.doc.firstChild?.firstChild?.attrs.checked).toBe(false);
  });

  it("sets checked on an existing task_item's own line instead of nesting another wrap", () => {
    // Two task_items already exist (e.g. from pressing Enter on the first);
    // typing "[x] " on the second item's blank line should just flip *that*
    // item's checked attr, not fail silently (the bug a plain
    // wrappingInputRule has: findWrapping doesn't know "already wrapped").
    const first = schema.node('task_item', { checked: false }, schema.node('paragraph', null, schema.text('one')));
    const second = schema.node('task_item', { checked: false }, schema.node('paragraph', null, schema.text('[x] two')));
    const list = schema.node('task_list', null, [first, second]);
    const doc = schema.node('doc', null, [list]);
    const state = EditorState.create({ schema, doc });

    // Find where the second item's paragraph content starts.
    let secondParaStart = -1;
    state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent.startsWith('[x] two')) secondParaStart = pos + 1;
    });
    expect(secondParaStart).toBeGreaterThan(-1);

    const match = CHECKLIST_RULE.exec('[x] ') as RegExpMatchArray;
    const tr = checklistRuleHandler(schema)(state, match, secondParaStart, secondParaStart + '[x] '.length);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);

    expect(next.doc.firstChild?.type.name).toBe('task_list');
    expect(next.doc.firstChild?.childCount).toBe(2); // no extra nesting/wrapping
    expect(next.doc.firstChild?.child(0).attrs.checked).toBe(false);
    expect(next.doc.firstChild?.child(1).attrs.checked).toBe(true);
    expect(next.doc.firstChild?.child(1).textContent).toBe('two');
  });
});

describe('horizontal rule input rule', () => {
  it('matches bare ---, ___ and *** triggers', () => {
    expect(HORIZONTAL_RULE_RULE.test('---')).toBe(true);
    expect(HORIZONTAL_RULE_RULE.test('___')).toBe(true);
    expect(HORIZONTAL_RULE_RULE.test('***')).toBe(true);
  });

  it("doesn't match a dash run of a different length (not the exact 3-character trigger)", () => {
    expect(HORIZONTAL_RULE_RULE.test('--')).toBe(false);
    expect(HORIZONTAL_RULE_RULE.test('----')).toBe(false);
  });

  it('replaces the trigger text with a horizontal_rule node in a plain paragraph', () => {
    const next = run('---', HORIZONTAL_RULE_RULE, horizontalRuleHandler(schema));
    expect(next?.doc.childCount).toBe(1);
    expect(next?.doc.firstChild?.type.name).toBe('horizontal_rule');
  });

  it('splits the enclosing paragraph inside a table cell, same as outside any table — the guard that used to block this was removed once cells hold real block content (see schema.ts), and this stays schema-valid: still one row, one cell, same column count', () => {
    const types = tableNodeTypes(schema);
    const cell = types.header_cell.create(null, [schema.nodes.paragraph.create(null, schema.text('a---b'))]);
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    const state = EditorState.create({ schema, doc });
    let textStart = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'a---b') textStart = pos;
    });
    const match = HORIZONTAL_RULE_RULE.exec('---') as RegExpMatchArray;
    // Match spans just the "---" in the middle of "a---b".
    const tr = horizontalRuleHandler(schema)(state, match, textStart + 1, textStart + 4);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    const table = next.doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(1); // still one row
    const restoredCell = table.firstChild!.firstChild!;
    expect(restoredCell.childCount).toBe(3); // "a" paragraph, hr, "b" paragraph — split, not corrupted
    expect(restoredCell.child(0).textContent).toBe('a');
    expect(restoredCell.child(1).type.name).toBe('horizontal_rule');
    expect(restoredCell.child(2).textContent).toBe('b');
  });

  it('appends an empty paragraph after the rule when it would otherwise be the cell\'s whole content — confirmed live that leaving a cell with only an hr (no textblock) makes the NEXT typed character jump to a different cell entirely instead of landing locally', () => {
    const types = tableNodeTypes(schema);
    const cell = types.header_cell.create(null, [schema.nodes.paragraph.create(null, schema.text('---'))]);
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    const state = EditorState.create({ schema, doc });
    let textStart = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === '---') textStart = pos;
    });
    const match = HORIZONTAL_RULE_RULE.exec('---') as RegExpMatchArray;
    const tr = horizontalRuleHandler(schema)(state, match, textStart, textStart + 3);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    const restoredCell = next.doc.firstChild!.firstChild!.firstChild!;
    expect(restoredCell.childCount).toBe(2); // hr, plus a fresh empty paragraph to type into
    expect(restoredCell.child(0).type.name).toBe('horizontal_rule');
    expect(restoredCell.child(1).type.name).toBe('paragraph');
    expect(restoredCell.child(1).content.size).toBe(0);
  });
});

describe('table-structure keymap survives macOS Option-key character composition', () => {
  // On macOS, Option(+Shift)+<letter> can compose into an entirely
  // unrelated accented/special character in `event.key`, depending on
  // keyboard layout — confirmed live for at least one real combination.
  // prosemirror-keymap's own event.keyCode-based fallback (see
  // keydownHandler in prosemirror-keymap) rescues a binding *only* when it
  // was registered in the `Shift-Alt-<lowercase>` shape (what that
  // fallback always reconstructs) — never the `Alt-<UPPERCASE>` shorthand,
  // which relies on `event.key` already being the correctly-cased letter
  // and has nothing left to fall back on once that's a composed,
  // unrelated character instead. This regression test simulates that
  // composition directly against the real keymap `buildPlugins` wires, to
  // catch a future table-shortcut binding written the fragile way.
  function findHandleKeyDown(): (view: unknown, event: KeyboardEvent) => boolean {
    const plugin = buildPlugins(schema).find((p) => p.props.handleKeyDown);
    if (!plugin?.props.handleKeyDown) throw new Error('no keymap plugin with handleKeyDown found');
    return plugin.props.handleKeyDown as (view: unknown, event: KeyboardEvent) => boolean;
  }

  function fakeEvent(init: { key: string; keyCode: number; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }): KeyboardEvent {
    return { ...init, altKey: !!init.altKey, shiftKey: !!init.shiftKey, metaKey: !!init.metaKey, ctrlKey: false } as KeyboardEvent;
  }

  function stateWithOneCellTable(): { view: { state: EditorState; dispatch: (tr: Transaction) => void } } {
    const types = tableNodeTypes(schema);
    const cell = types.header_cell.create(null, [schema.nodes.paragraph.create()]);
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    const view = {
      get state() { return state; },
      dispatch(tr: Transaction) { state = state.apply(tr); },
    };
    return { view };
  }

  it('Alt-Shift-r (add row) fires even when event.key is a composed character, keyed off event.keyCode', () => {
    const handleKeyDown = findHandleKeyDown();
    const { view } = stateWithOneCellTable();
    const rowsBefore = view.state.doc.firstChild!.childCount;
    const handled = handleKeyDown(view, fakeEvent({ key: '‰', keyCode: 82, altKey: true, shiftKey: true }));
    expect(handled).toBe(true);
    expect(view.state.doc.firstChild!.childCount).toBe(rowsBefore + 1);
  });

  it('Alt-Shift-c (add column) fires even when event.key is a composed character', () => {
    const handleKeyDown = findHandleKeyDown();
    const { view } = stateWithOneCellTable();
    const colsBefore = view.state.doc.firstChild!.firstChild!.childCount;
    const handled = handleKeyDown(view, fakeEvent({ key: 'ç', keyCode: 67, altKey: true, shiftKey: true }));
    expect(handled).toBe(true);
    expect(view.state.doc.firstChild!.firstChild!.childCount).toBe(colsBefore + 1);
  });

  it('Alt-Shift-h (toggle header row) fires even when event.key is a composed character', () => {
    const handleKeyDown = findHandleKeyDown();
    const { view } = stateWithOneCellTable();
    const wasHeader = view.state.doc.firstChild!.firstChild!.firstChild!.type.name === 'table_header';
    const handled = handleKeyDown(view, fakeEvent({ key: '˙', keyCode: 72, altKey: true, shiftKey: true }));
    expect(handled).toBe(true);
    const isHeaderNow = view.state.doc.firstChild!.firstChild!.firstChild!.type.name === 'table_header';
    expect(isHeaderNow).toBe(!wasHeader);
  });

  it('still fires normally when event.key correctly reports the shifted letter (Windows/Linux, or macOS with no composition)', () => {
    const handleKeyDown = findHandleKeyDown();
    const { view } = stateWithOneCellTable();
    const rowsBefore = view.state.doc.firstChild!.childCount;
    const handled = handleKeyDown(view, fakeEvent({ key: 'R', keyCode: 82, altKey: true, shiftKey: true }));
    expect(handled).toBe(true);
    expect(view.state.doc.firstChild!.childCount).toBe(rowsBefore + 1);
  });
});
