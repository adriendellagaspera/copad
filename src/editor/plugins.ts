import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from 'prosemirror-inputrules';
import { undo, redo } from 'y-prosemirror';
import type { MarkType, Schema } from 'prosemirror-model';
import type { EditorState, Plugin, Transaction } from 'prosemirror-state';
import { normalizeHref, isValidHref } from './linkCommands.js';

type RuleHandler = (
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number
) => Transaction | null;

/**
 * Handler for a "typed markdown closes into a mark" input rule — e.g.
 * `**bold**` or `` `code` ``. The paired regexp must anchor at the end (`$`)
 * with two capture groups: group 1 the whole delimited run (delimiters
 * included), group 2 the inner text. Delimiters are assumed symmetric (same
 * length either side), true for every mark syntax we support. Exported
 * (alongside the regexes below) so the rule logic is unit-testable without a
 * DOM `EditorView`.
 */
export function markRuleHandler(markType: MarkType): RuleHandler {
  return (state, match, start) => {
    const delimited = match[1];
    const inner = match[2];
    if (!delimited || !inner) return null;
    const { tr } = state;
    const matchStart = start + match[0].indexOf(delimited);
    const matchEnd = matchStart + delimited.length;
    const delimLen = (delimited.length - inner.length) / 2;
    const innerStart = matchStart + delimLen;
    const innerEnd = innerStart + inner.length;
    if (matchEnd > innerEnd) tr.delete(innerEnd, matchEnd);
    tr.addMark(innerStart, innerEnd, markType.create());
    tr.removeStoredMark(markType);
    if (innerStart > matchStart) tr.delete(matchStart, innerStart);
    return tr;
  };
}

/** `[text](url)` closing into a link mark, replacing the raw markdown syntax. */
export function linkRuleHandler(markType: MarkType): RuleHandler {
  return (state, match, start) => {
    const whole = match[1];
    const text = match[2];
    const rawHref = match[3];
    if (!whole || !text || !rawHref || !isValidHref(rawHref)) return null;
    const href = normalizeHref(rawHref);
    if (!href) return null;
    const { tr } = state;
    const matchStart = start + match[0].indexOf(whole);
    const matchEnd = matchStart + whole.length;
    tr.delete(matchStart, matchEnd);
    tr.insertText(text, matchStart);
    tr.addMark(matchStart, matchStart + text.length, markType.create({ href }));
    tr.removeStoredMark(markType);
    return tr;
  };
}

/** Bold: `**text**` or `__text__`. */
export const BOLD_STAR_RULE = /(?:^|\s)(\*\*(?!\s)([^*]+)\*\*)$/;
export const BOLD_UNDERSCORE_RULE = /(?:^|\s)(__(?!\s)([^_]+)__)$/;
/** Italic: `*text*` or `_text_`. Declared after the bold rules so a closing
 *  `**` is never read as a dangling `*` (see {@link markRuleHandler}'s
 *  delimiter-length math — the two never actually collide, but the order
 *  documents the intent). */
export const ITALIC_STAR_RULE = /(?:^|\s)(\*(?!\s)([^*]+)\*)$/;
export const ITALIC_UNDERSCORE_RULE = /(?:^|\s)(_(?!\s)([^_]+)_)$/;
/** Strikethrough: `~~text~~`. */
export const STRIKE_RULE = /(?:^|\s)(~~(?!\s)([^~]+)~~)$/;
/** Inline code: `` `text` ``. */
export const CODE_RULE = /(?:^|\s)(`(?!\s)([^`]+)`)$/;
/** Link: `[text](url)`. */
export const LINK_RULE = /(?:^|\s)(\[([^\]]+)\]\(([^)\s]+)\))$/;

export function buildPlugins(s: Schema): Plugin[] {
  return [
    keymap({
      'Mod-b': toggleMark(s.marks.strong),
      'Mod-i': toggleMark(s.marks.em),
      'Mod-`': toggleMark(s.marks.code),
      'Mod-Shift-x': toggleMark(s.marks.strike),
      // Mod-U alone is Chrome/Firefox's reserved "View Source" shortcut and
      // can't be preventDefault-ed, so it never reaches the page — Shift it.
      'Mod-Shift-u': toggleMark(s.marks.underline),
      // Bridge to the Svelte LinkPopover — handled by a listener on the editor DOM.
      'Mod-k': (_state, _dispatch, view) => {
        view?.dom.dispatchEvent(new CustomEvent('copad:link', { bubbles: true }));
        return true;
      },
      // Block-type shortcuts — the Google Docs / Notion convention (Mod-Alt-0
      // is "normal text", Mod-Alt-1..3 the heading levels), so the floating
      // toolbar is never the only way to reach these while writing.
      'Mod-Alt-0': setBlockType(s.nodes.paragraph),
      'Mod-Alt-1': setBlockType(s.nodes.heading, { level: 1 }),
      'Mod-Alt-2': setBlockType(s.nodes.heading, { level: 2 }),
      'Mod-Alt-3': setBlockType(s.nodes.heading, { level: 3 }),
      'Mod-Alt-c': setBlockType(s.nodes.code_block),
      'Mod-Shift-7': wrapInList(s.nodes.ordered_list),
      'Mod-Shift-8': wrapInList(s.nodes.bullet_list),
      'Mod-Shift-9': wrapIn(s.nodes.blockquote),
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      // Firefox blurs contenteditable elements on Escape by default; swallow it
      // so the caret stays in the document (the slash menu handles its own
      // Escape first, via slashMenuPlugin running earlier in the plugin list).
      'Escape': () => true,
      'Enter': splitListItem(s.nodes.list_item),
      'Tab': sinkListItem(s.nodes.list_item),
      'Shift-Tab': liftListItem(s.nodes.list_item),
    }),
    keymap(baseKeymap),
    inputRules({
      rules: [
        textblockTypeInputRule(/^#\s$/, s.nodes.heading, { level: 1 }),
        textblockTypeInputRule(/^##\s$/, s.nodes.heading, { level: 2 }),
        textblockTypeInputRule(/^###\s$/, s.nodes.heading, { level: 3 }),
        textblockTypeInputRule(/^```$/, s.nodes.code_block),
        wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
        wrappingInputRule(/^\s*([-+*])\s$/, s.nodes.bullet_list),
        wrappingInputRule(/^(\d+)\.\s$/, s.nodes.ordered_list),
        // `---`, `***` or `___` on their own line → horizontal rule.
        new InputRule(/^(?:---|___|\*\*\*)$/, (state, _match, start, end) => {
          return state.tr.replaceRangeWith(start, end, s.nodes.horizontal_rule.create());
        }),
        // Inline mark syntax — bold before italic so `**x**` can't be read as
        // a dangling `*x*` (see markRuleHandler's delimiter-length math).
        new InputRule(BOLD_STAR_RULE, markRuleHandler(s.marks.strong)),
        new InputRule(BOLD_UNDERSCORE_RULE, markRuleHandler(s.marks.strong)),
        new InputRule(ITALIC_STAR_RULE, markRuleHandler(s.marks.em)),
        new InputRule(ITALIC_UNDERSCORE_RULE, markRuleHandler(s.marks.em)),
        new InputRule(STRIKE_RULE, markRuleHandler(s.marks.strike)),
        new InputRule(CODE_RULE, markRuleHandler(s.marks.code)),
        new InputRule(LINK_RULE, linkRuleHandler(s.marks.link)),
      ],
    }),
  ];
}
