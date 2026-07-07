import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema } from './schema.js';
import {
  markRuleHandler,
  linkRuleHandler,
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
