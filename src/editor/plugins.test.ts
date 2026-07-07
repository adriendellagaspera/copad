import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema } from './schema.js';
import {
  markRuleHandler,
  linkRuleHandler,
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
