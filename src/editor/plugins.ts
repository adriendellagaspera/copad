import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from 'prosemirror-inputrules';
import { undo, redo } from 'y-prosemirror';
import { goToNextCell, columnResizing, tableEditing } from 'prosemirror-tables';
import { findWrapping } from 'prosemirror-transform';
import type { MarkType, Schema } from 'prosemirror-model';
import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
import { normalizeHref, isValidHref } from './linkCommands.js';
import { taskItemCheckboxPlugin } from './taskList.js';

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
/** Checklist: bare `[] `/`[ ] `/`[x] ` at the start of a line — deliberately
 *  *not* `- [ ] ` (GFM's file syntax, handled on markdown import instead):
 *  the bullet-list rule above already fires on `- ` alone, so a dash-prefixed
 *  trigger could never be typed before that rule pre-empts it. */
export const CHECKLIST_RULE = /^\s*\[([ xX]?)\]\s$/;

/**
 * Handles both checklist shapes a plain `wrappingInputRule` can't tell apart:
 * typing `[x] ` on an *existing* task_item's own line (the common case — you
 * pressed Enter to get a new checklist row, then mark it done) just needs
 * `checked` flipped, not another wrap; `findWrapping` has no notion of "this
 * paragraph already lives in one" and returns null there, so a bare
 * `wrappingInputRule(CHECKLIST_RULE, task_item, …)` silently no-ops on every
 * item after the first. Elsewhere (a plain paragraph, a bullet item, …) it
 * wraps the block in a new task_list/task_item, same as the library helper.
 */
export function checklistRuleHandler(s: Schema): RuleHandler {
  return (state, match, start, end) => {
    const checked = /x/i.test(match[1] ?? '');
    const { tr } = state;
    const $start = tr.doc.resolve(start);
    const parentDepth = $start.depth;
    if (parentDepth > 0 && $start.node(parentDepth - 1).type === s.nodes.task_item && $start.index(parentDepth - 1) === 0) {
      tr.delete(start, end);
      tr.setNodeMarkup($start.before(parentDepth - 1), undefined, { checked });
      return tr;
    }
    tr.delete(start, end);
    const $wrapAt = tr.doc.resolve(start);
    const range = $wrapAt.blockRange();
    const wrapping = range && findWrapping(range, s.nodes.task_item, { checked });
    if (!wrapping) return null;
    tr.wrap(range, wrapping);
    return tr;
  };
}

/** Swallow Enter inside a table cell instead of letting `baseKeymap`'s
 *  `splitBlock` split the cell itself in two — GFM-shaped cells are
 *  single-line (`cellContent: 'inline*'`, see schema.ts), so there's no
 *  "new paragraph within the cell" to make room for. */
function preventEnterInTableCell(s: Schema): Command {
  return (state) => {
    const { parent } = state.selection.$from;
    return parent.type === s.nodes.table_cell || parent.type === s.nodes.table_header;
  };
}

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
      // 6 slots in next to 7/8/9 (ordered/bullet/quote) for the one other
      // list-shaped block type — checklist.
      'Mod-Shift-6': wrapInList(s.nodes.task_list),
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
      'Enter': chainCommands(
        preventEnterInTableCell(s),
        splitListItem(s.nodes.list_item),
        splitListItem(s.nodes.task_item)
      ),
      'Tab': chainCommands(
        goToNextCell(1),
        sinkListItem(s.nodes.list_item),
        sinkListItem(s.nodes.task_item)
      ),
      'Shift-Tab': chainCommands(
        goToNextCell(-1),
        liftListItem(s.nodes.list_item),
        liftListItem(s.nodes.task_item)
      ),
    }),
    keymap(baseKeymap),
    inputRules({
      rules: [
        textblockTypeInputRule(/^#\s$/, s.nodes.heading, { level: 1 }),
        textblockTypeInputRule(/^##\s$/, s.nodes.heading, { level: 2 }),
        textblockTypeInputRule(/^###\s$/, s.nodes.heading, { level: 3 }),
        textblockTypeInputRule(/^```$/, s.nodes.code_block),
        wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
        // Checklist before plain bullet — both start with punctuation the
        // bullet rule doesn't match (`[`), so order is only for clarity here.
        new InputRule(CHECKLIST_RULE, checklistRuleHandler(s)),
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
    columnResizing(),
    tableEditing(),
    taskItemCheckboxPlugin,
  ];
}
