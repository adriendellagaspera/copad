import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import { tableNodeTypes } from 'prosemirror-tables';
import { schema } from './schema.js';
import {
  markRuleHandler,
  linkRuleHandler,
  escapeCodeBlock,
  exitCodeBlockDown,
  exitCodeBlockOnBlankLine,
  clearEmptyCodeBlockBackward,
  exitTableAtBoundary,
  backspaceAtTableStart,
  tabAddsRowAtEnd,
  insertHardBreak,
  toggleBlockType,
  checklistRuleHandler,
  BOLD_STAR_RULE,
  BOLD_UNDERSCORE_RULE,
  ITALIC_STAR_RULE,
  ITALIC_UNDERSCORE_RULE,
  STRIKE_RULE,
  CODE_RULE,
  LINK_RULE,
  CHECKLIST_RULE,
} from './plugins.js';

/** A bare 1×1 table (one header cell, no body row) — the smallest doc shape
 *  that can trap a caret at both the first and the last cell at once. */
function oneCellTable() {
  const types = tableNodeTypes(schema);
  return types.table.create(null, [types.row.create(null, [types.header_cell.create()])]);
}

/** A one-paragraph doc containing `text`, with the handler invoked as if the
 *  caret sits right after `text` (mimicking the character that just closed
 *  the input rule). */
function run(
  text: string,
  regexp: RegExp,
  handler: ReturnType<typeof markRuleHandler> | ReturnType<typeof linkRuleHandler> | ReturnType<typeof checklistRuleHandler>
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

describe('exitTableAtBoundary', () => {
  const up = exitTableAtBoundary(schema, -1);
  const down = exitTableAtBoundary(schema, 1);

  it('inserts a paragraph before a table that opens the doc, on Enter at the start of its first cell', () => {
    const doc = schema.node('doc', null, [oneCellTable()]);
    // Position 3: into the table (1), into the row (1), into the cell's own content (1).
    const { handled, dispatched, next } = runCmd(up, doc, 3);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('paragraph');
    expect(next!.doc.child(1).type.name).toBe('table');
    // The caret lands inside the freshly inserted paragraph, not the table.
    expect(next!.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('inserts a paragraph after a table that closes the doc, on Enter at the end of its last cell', () => {
    const doc = schema.node('doc', null, [oneCellTable()]);
    const { handled, dispatched, next } = runCmd(down, doc, 3);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.firstChild?.type.name).toBe('table');
    expect(next!.doc.child(1).type.name).toBe('paragraph');
    expect(next!.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('moves into an existing paragraph before the table instead of inserting a new one', () => {
    const before = schema.node('paragraph', null, schema.text('above'));
    const doc = schema.node('doc', null, [before, oneCellTable()]);
    const cellStart = before.nodeSize + 3; // end of the paragraph, then into table/row/cell
    const { handled, dispatched, next } = runCmd(up, doc, cellStart);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2); // no extra paragraph inserted
    expect(next!.selection.$from.parent.textContent).toBe('above');
  });

  it('moves into an existing paragraph after the table instead of inserting a new one', () => {
    const after = schema.node('paragraph', null, schema.text('below'));
    const doc = schema.node('doc', null, [oneCellTable(), after]);
    const { handled, dispatched, next } = runCmd(down, doc, 3);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.selection.$from.parent.textContent).toBe('below');
  });

  it('does not fire for Enter in the middle of a multi-cell row (not a boundary)', () => {
    const types = tableNodeTypes(schema);
    const row = types.row.create(null, [types.header_cell.create(), types.header_cell.create()]);
    const table = types.table.create(null, [row]);
    const doc = schema.node('doc', null, [table]);
    // Position inside the *second* cell — not index 0, so the "start" exit must not fire.
    const secondCellPos = 2 + types.header_cell.create().nodeSize;
    const { handled, dispatched } = runCmd(up, doc, secondCellPos);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('returns false outside a table entirely', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('x'))]);
    const { handled, dispatched } = runCmd(up, doc, 1);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe('backspaceAtTableStart', () => {
  const bs = backspaceAtTableStart(schema);

  it('deletes an empty paragraph directly above the table', () => {
    const empty = schema.node('paragraph');
    const doc = schema.node('doc', null, [empty, oneCellTable()]);
    const cellStart = empty.nodeSize + 3; // end of the empty paragraph, then into table/row/cell
    const { handled, dispatched, next } = runCmd(bs, doc, cellStart);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(1); // the empty paragraph is gone
    expect(next!.doc.firstChild?.type.name).toBe('table');
  });

  it('moves the caret to the end of a non-empty paragraph above the table, without deleting or merging it', () => {
    const before = schema.node('paragraph', null, schema.text('above'));
    const doc = schema.node('doc', null, [before, oneCellTable()]);
    const cellStart = before.nodeSize + 3;
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
    const cell = tableNodeTypes(schema).header_cell.create(null, schema.text('ab'));
    const doc = schema.node('doc', null, [
      empty,
      tableNodeTypes(schema).table.create(null, [tableNodeTypes(schema).row.create(null, [cell])]),
    ]);
    const midCellPos = empty.nodeSize + 4; // between "a" and "b" — cell offset 1, not 0
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
});

describe('tabAddsRowAtEnd', () => {
  const tab = tabAddsRowAtEnd(schema);

  it('adds a new row and moves into its first cell, from the last cell of a 1×1 table', () => {
    const doc = schema.node('doc', null, [oneCellTable()]);
    const { handled, dispatched, next } = runCmd(tab, doc, 3);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.firstChild?.childCount).toBe(2); // grew from 1 row to 2
    expect(next!.selection.$from.parent.type.name).toMatch(/table_cell|table_header/);
    // The new row is the caret's ancestor row, and it's the table's last child.
    const table = next!.doc.firstChild!;
    const row = next!.selection.$from.node(next!.selection.$from.depth - 1);
    expect(row).toBe(table.lastChild);
  });

  it('does not fire from the last cell of a non-last row (goToNextCell already has somewhere to go)', () => {
    const types = tableNodeTypes(schema);
    const firstRow = types.row.create(null, [types.header_cell.create()]);
    const secondRow = types.row.create(null, [types.cell.create()]);
    const doc = schema.node('doc', null, [types.table.create(null, [firstRow, secondRow])]);
    const { handled, dispatched } = runCmd(tab, doc, 3); // inside the first (non-last) row's only cell
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

describe('insertHardBreak', () => {
  it('inserts a hard_break node at the caret in a plain paragraph', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('hi'))]);
    const { handled, dispatched, next } = runCmd(insertHardBreak, doc, 2); // between "h" and "i"
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.firstChild?.childCount).toBe(3); // "h", hard_break, "i"
    expect(next!.doc.firstChild?.child(1).type.name).toBe('hard_break');
  });

  it('inserts a hard_break inside a table cell (already valid — cellContent is inline*)', () => {
    const types = tableNodeTypes(schema);
    const cell = types.header_cell.create(null, schema.text('ab'));
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    const { handled, dispatched, next } = runCmd(insertHardBreak, doc, 4); // between "a" and "b"
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    const restoredCell = next!.doc.firstChild?.firstChild?.firstChild;
    expect(restoredCell?.childCount).toBe(3);
    expect(restoredCell?.child(1).type.name).toBe('hard_break');
  });

  it('returns false inside a code block (falls through to native newline-in-<pre>)', () => {
    const doc = schema.node('doc', null, [schema.node('code_block', null, schema.text('ab'))]);
    const { handled, dispatched } = runCmd(insertHardBreak, doc, 2);
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
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
