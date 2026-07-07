import { keymap } from 'prosemirror-keymap';
import { chainCommands, baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from 'prosemirror-inputrules';
import { undo, redo } from 'y-prosemirror';
import type { MarkType, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { Selection } from 'prosemirror-state';
import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
import { normalizeHref, isValidHref } from './linkCommands.js';

/**
 * Leaves `$pos`'s enclosing code block (a node with `code: true`), mutating
 * `tr` in place. Never mutates the code block itself, even an empty one —
 * it may be deliberately blank, waiting to be filled in, so merely passing
 * over it must not be destructive (matches Tiptap's CodeBlock extension,
 * the reference implementation for this exact pattern: its `exitCode`-based
 * exits never delete or convert the block; only its Backspace handler and
 * its `Mod-Alt-c` toggle do — see `clearEmptyCodeBlockBackward` and
 * `toggleCodeBlock` in commands.ts below):
 * - if a block already follows it, the selection simply moves there — no
 *   need to insert a duplicate paragraph, same as arrowing/clicking past the
 *   block would land you in it;
 * - else a fresh paragraph is inserted after it and selected (most often
 *   because the code block is the last node in the doc).
 *
 * Shared by every way of leaving a code block — Escape, ArrowDown at the
 * last position, and three-Enters-in-a-row on a trailing blank line — so
 * they all converge on one consistent exit.
 */
function exitCodeBlock(tr: Transaction, $pos: ResolvedPos): void {
  const container = $pos.node(-1);
  const indexAfter = $pos.indexAfter(-1);
  const after = $pos.after();

  if (indexAfter < container.childCount) {
    tr.setSelection(Selection.near(tr.doc.resolve(after), 1));
    return;
  }

  const type = container.contentMatchAt(indexAfter).defaultType ?? tr.doc.type.schema.nodes.paragraph;
  const node = type.createAndFill();
  if (!node) return;
  tr.insert(after, node);
  tr.setSelection(Selection.near(tr.doc.resolve(after), 1));
}

/** True when the caret sits in a code block and nowhere else (an empty or
 *  cross-parent selection doesn't have a single unambiguous block to exit). */
function inCodeBlock(state: EditorState): ResolvedPos | null {
  const { $head, $anchor } = state.selection;
  if (!$head.sameParent($anchor) || !$head.parent.type.spec.code) return null;
  return $head;
}

/**
 * Escape a code block into whatever follows it — otherwise a code_block
 * with nothing after it (most often because it's the last node in the doc)
 * has no textblock below it to click or arrow into, trapping the caret
 * (`Enter`'s `newlineInCode` just keeps adding lines inside the block
 * instead of leaving it). Works from anywhere in the block, not just the
 * last line.
 *
 * Always returns `true`: Firefox blurs contenteditable elements on Escape by
 * default, so it's swallowed even when there's no code block to exit (the
 * slash menu handles its own Escape first, via slashMenuPlugin running
 * earlier in the plugin list).
 */
export const escapeCodeBlock: Command = (state, dispatch) => {
  const $pos = inCodeBlock(state);
  if (!$pos) return true;
  if (dispatch) {
    const tr = state.tr;
    exitCodeBlock(tr, $pos);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * ArrowDown at the very end of a code block's content leaves it the same
 * way Escape does. Native caret movement already handles ArrowDown *within*
 * a multi-line code block (and between it and a following block, when the
 * browser can find a line to land the caret on below) — this only fires at
 * the one position where the browser has nowhere left to move the caret to,
 * which is otherwise indistinguishable from the key doing nothing at all.
 * Returns `false` everywhere else so normal ArrowDown handling proceeds.
 */
export const exitCodeBlockDown: Command = (state, dispatch) => {
  const $pos = inCodeBlock(state);
  if (!$pos || $pos.parentOffset !== $pos.parent.content.size) return false;
  if (dispatch) {
    const tr = state.tr;
    exitCodeBlock(tr, $pos);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Three Enters in a row (i.e. the code block's content already ends with
 * two newlines when a third Enter arrives) leaves the code block, undoing
 * the two blank lines that got us here first so genuine code isn't split by
 * an exit gesture. A single blank line is common and intentional inside
 * real code (spacing between functions), so a lone Enter must never trigger
 * this — only a second consecutive blank line unambiguously signals "let me
 * out". Matches Tiptap's `exitOnTripleEnter` exactly (verified against its
 * source): a code block that was only blank lines is left behind as an
 * empty code block, not deleted — `clearEmptyCodeBlockBackward` (Backspace)
 * or the `Mod-Alt-c` toggle are what remove it, same as everywhere else
 * this file leaves the block itself alone.
 * Returns `false` everywhere else so normal Enter handling (newlineInCode)
 * proceeds.
 */
export const exitCodeBlockOnBlankLine: Command = (state, dispatch) => {
  const $pos = inCodeBlock(state);
  if (!$pos) return false;
  const block = $pos.parent;
  if ($pos.parentOffset !== block.content.size) return false;
  if (!block.textContent.endsWith('\n\n')) return false;
  if (dispatch) {
    const tr = state.tr.delete($pos.pos - 2, $pos.pos);
    exitCodeBlock(tr, tr.doc.resolve($pos.pos - 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Backspace at the start of an empty code block converts it straight back
 * into an empty paragraph — the way to get rid of a code block you opened
 * by mistake or emptied out, matching Tiptap's CodeBlock Backspace handler
 * (verified against its source) and this app's own existing convention for
 * every other empty block (baseKeymap's Backspace already lifts/removes an
 * empty paragraph, heading, etc. the same way). Deliberately narrower than
 * Tiptap's version, which also fires on a *non-empty* code block sitting at
 * the very start of the document — an edge case this app doesn't otherwise
 * special-case for any other block type, so extending it here would be an
 * inconsistency, not a fix.
 * Returns `false` everywhere else so normal Backspace handling (character
 * deletion, joining with the previous block, etc.) proceeds.
 */
export const clearEmptyCodeBlockBackward: Command = (state, dispatch) => {
  const $pos = inCodeBlock(state);
  if (!$pos || $pos.parent.content.size !== 0 || $pos.parentOffset !== 0) return false;
  if (dispatch) {
    dispatch(state.tr.setNodeMarkup($pos.before(), state.schema.nodes.paragraph));
  }
  return true;
};

/**
 * Toggle between `type` and `paragraph` for the block(s) under the
 * selection — the same command that opened a block converts it back when
 * invoked from inside one, so the code-block command itself is a way to
 * remove a code block, not just a way to create one. Matches how every
 * other toggleable command in this app already reads (`toggleMark` for
 * bold/italic/strike), and Tiptap's own `toggleCodeBlock` bound to this
 * exact `Mod-Alt-c` shortcut (verified against its source).
 */
export function toggleBlockType(type: NodeType, paragraph: NodeType): Command {
  const setType = setBlockType(type);
  const setParagraph = setBlockType(paragraph);
  return (state, dispatch, view) => {
    const { $from, to } = state.selection;
    const active = to <= $from.end() && $from.parent.hasMarkup(type);
    return (active ? setParagraph : setType)(state, dispatch, view);
  };
}

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
      'Mod-Alt-c': toggleBlockType(s.nodes.code_block, s.nodes.paragraph),
      'Mod-Shift-7': wrapInList(s.nodes.ordered_list),
      'Mod-Shift-8': wrapInList(s.nodes.bullet_list),
      'Mod-Shift-9': wrapIn(s.nodes.blockquote),
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      'Escape': escapeCodeBlock,
      'ArrowDown': exitCodeBlockDown,
      'Enter': chainCommands(exitCodeBlockOnBlankLine, splitListItem(s.nodes.list_item)),
      'Backspace': clearEmptyCodeBlockBackward,
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
