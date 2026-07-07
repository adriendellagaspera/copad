import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import { schema } from './schema.js';
import {
  markRuleHandler,
  linkRuleHandler,
  escapeCodeBlock,
  exitCodeBlockDown,
  exitCodeBlockOnBlankLine,
  BOLD_STAR_RULE,
  BOLD_UNDERSCORE_RULE,
  ITALIC_STAR_RULE,
  ITALIC_UNDERSCORE_RULE,
  STRIKE_RULE,
  CODE_RULE,
  LINK_RULE,
} from './plugins.js';

/** A one-paragraph doc containing `text`, with the handler invoked as if the
 *  caret sits right after `text` (mimicking the character that just closed
 *  the input rule). */
function run(
  text: string,
  regexp: RegExp,
  handler: ReturnType<typeof markRuleHandler> | ReturnType<typeof linkRuleHandler>
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

  it('converts an empty trailing code block directly into a paragraph, in place (no orphaned empty code block)', () => {
    const codeBlock = schema.node('code_block');
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(1);
    expect(next!.doc.firstChild?.type.name).toBe('paragraph');
    expect(next!.doc.firstChild?.content.size).toBe(0);
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

  it('converts an empty code block in place when nested alone in a blockquote', () => {
    const codeBlock = schema.node('code_block');
    const blockquote = schema.node('blockquote', null, [codeBlock]);
    const doc = schema.node('doc', null, [blockquote]);
    const { next } = run(doc, 2);
    expect(next!.doc.firstChild?.childCount).toBe(1);
    expect(next!.doc.firstChild?.firstChild?.type.name).toBe('paragraph');
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

  it('converts an empty trailing code block into a paragraph in place', () => {
    const codeBlock = schema.node('code_block');
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(1);
    expect(next!.doc.firstChild?.type.name).toBe('paragraph');
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

  it('a code block that was only blank lines converts in place instead of leaving an empty code block behind', () => {
    const codeBlock = schema.node('code_block', null, schema.text('\n\n'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 3);
    expect(next!.doc.childCount).toBe(1);
    expect(next!.doc.firstChild?.type.name).toBe('paragraph');
    expect(next!.doc.firstChild?.content.size).toBe(0);
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
