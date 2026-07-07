import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';
import {
  markRuleHandler,
  linkRuleHandler,
  escapeCodeBlock,
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

describe('escapeCodeBlock', () => {
  /** Runs escapeCodeBlock and returns { handled, next, dispatched } — `next`
   *  is the resulting state if a transaction was dispatched, else null. */
  function run(
    doc: ReturnType<typeof schema.node>,
    selPos: number
  ): { handled: boolean; next: EditorState | null; dispatched: boolean } {
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, selPos) });
    let next: EditorState | null = null;
    let dispatched = false;
    const handled = escapeCodeBlock(state, (tr) => {
      dispatched = true;
      next = state.apply(tr);
    });
    return { handled, next, dispatched };
  }

  it('exits a trailing code block (last node in the doc) into a new paragraph after it', () => {
    const codeBlock = schema.node('code_block', null, schema.text('let x = 1'));
    const doc = schema.node('doc', null, [codeBlock]);
    const { handled, next, dispatched } = run(doc, 3);
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.lastChild?.type.name).toBe('paragraph');
    expect(next!.selection.$head.parent.type.name).toBe('paragraph');
  });

  it('exits an empty trailing code block into a new paragraph after it', () => {
    const codeBlock = schema.node('code_block');
    const doc = schema.node('doc', null, [codeBlock]);
    const { next } = run(doc, 1);
    expect(next!.doc.childCount).toBe(2);
    expect(next!.doc.lastChild?.type.name).toBe('paragraph');
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
    const state = EditorState.create({
      schema,
      doc,
      // from inside the code block (pos 3) to inside the paragraph (pos past it)
      selection: TextSelection.create(doc, 3, doc.content.size - 1),
    });
    let dispatched = false;
    const handled = escapeCodeBlock(state, () => {
      dispatched = true;
    });
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
