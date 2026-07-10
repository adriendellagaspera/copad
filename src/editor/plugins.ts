import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from 'prosemirror-inputrules';
import { undo, redo, yUndoPluginKey } from 'y-prosemirror';
import { findWrapping } from 'prosemirror-transform';
import {
  goToNextCell,
  columnResizing,
  tableEditing,
  addRowAfter as addRowAfterRaw,
  deleteRow as deleteRowRaw,
  addColumnAfter as addColumnAfterRaw,
  deleteColumn as deleteColumnRaw,
  toggleHeaderRow as toggleHeaderRowRaw,
  CellSelection,
  cellAround,
  nextCell,
  TableMap,
} from 'prosemirror-tables';
import type { Attrs, MarkType, Node as PMNode, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { Selection, TextSelection, PluginKey, Plugin } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { normalizeHref, isValidHref } from './linkCommands.js';
import { taskItemCheckboxPlugin } from './taskList.js';

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

/** True when some ancestor of the caret (up to the doc) is a `type` node with
 *  matching `attrs` — the wrapping-node counterpart to `hasMarkup`, which only
 *  ever sees the immediate textblock. Used both to light a toolbar button and
 *  to decide a toggle's direction. */
function ancestorHasType(state: EditorState, type: NodeType, attrs?: Attrs | null): boolean {
  const { $from, to } = state.selection;
  if (to > $from.end($from.depth)) return false;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).hasMarkup(type, attrs ?? null)) return true;
  }
  return false;
}

/** Heading toggle: turn the line into a heading at `level`, or back to a plain
 *  paragraph if it already *is* that exact level — so re-pressing Mod-Alt-1 (or
 *  re-clicking H1) reverts to body text, the Docs/Notion convention. Switching
 *  between levels still just re-levels (H2 → H1), it only toggles off when the
 *  level already matches. */
export function toggleHeading(headingType: NodeType, paragraphType: NodeType, level: number): Command {
  return (state, dispatch, view) => {
    const active = ancestorHasType(state, headingType, { level });
    return (active ? setBlockType(paragraphType) : setBlockType(headingType, { level }))(state, dispatch, view);
  };
}

/** List toggle: wrap the block in `listType`, or lift it back out to a plain
 *  paragraph if it already lives in that list type — so the list shortcut/
 *  button is a real toggle (Docs/Notion), not a one-way trip. */
export function toggleList(listType: NodeType, itemType: NodeType): Command {
  const wrap = wrapInList(listType);
  const off = liftListItem(itemType);
  return (state, dispatch, view) =>
    (ancestorHasType(state, listType) ? off : wrap)(state, dispatch, view);
}

/** Wrap toggle (blockquote): wrap the block, or lift it out if already wrapped
 *  — stops the "re-invoke nests another blockquote forever, no way back out"
 *  trap and gives a keyboard/button path to un-quote. */
export function toggleWrap(wrapType: NodeType): Command {
  const wrap = wrapIn(wrapType);
  return (state, dispatch, view) =>
    (ancestorHasType(state, wrapType) ? lift : wrap)(state, dispatch, view);
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
    const textEnd = matchStart + text.length;
    tr.addMark(matchStart, textEnd, markType.create({ href }));
    // Park the caret explicitly right after the link text. Without this the
    // mapped selection biases *past* the insertion, which lands it in the
    // next cell when the rule fires inside a table (the cell boundary sits
    // one position beyond the text) — silently scattering further typing
    // into the wrong cell. An explicit in-cell caret keeps it put, in a
    // table or a paragraph alike.
    tr.setSelection(TextSelection.create(tr.doc, textEnd));
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
/** Horizontal rule: bare `---`, `***` or `___` on their own line. */
export const HORIZONTAL_RULE_RULE = /^(?:---|___|\*\*\*)$/;

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
    if (
      parentDepth > 0 &&
      $start.node(parentDepth - 1).type === s.nodes.task_item &&
      $start.index(parentDepth - 1) === 0
    ) {
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

/**
 * If a horizontal rule just landed as the *last* child of a table cell
 * (confirmed live: this happens whenever a cell's trailing content closes
 * into an hr — including a cell whose entire content was just the `---`
 * trigger, leaving the rule as its only child), ProseMirror's own
 * NodeSelection-around-the-rule lands right at the cell's outer edge —
 * typing further doesn't insert locally the way it does for an hr *outside*
 * any table (where it just replaces the selected node); instead it's been
 * observed to jump to the *next* cell entirely, silently losing whatever
 * was typed from the cell it visually looks like you're still in. Appending
 * an empty paragraph after the rule keeps a normal typable position inside
 * the same cell, the same shape {@link exitTableAtBoundary} used to give an
 * escape route — except this one never leaves the cell at all. A no-op
 * outside any table, or when the rule isn't actually the cell's last child
 * (e.g. `a---b`, which already keeps its own trailing "b" paragraph).
 */
export function keepCellTypableAfterHr(tr: Transaction, s: Schema, mappedPos: number): void {
  const $pos = tr.doc.resolve(mappedPos);
  const $cell = cellAround($pos);
  const cellNode = $cell?.nodeAfter;
  if (!$cell || !cellNode || cellNode.lastChild?.type !== s.nodes.horizontal_rule) return;
  const para = s.nodes.paragraph.createAndFill();
  if (!para) return;
  const insertAt = $cell.pos + 1 + cellNode.content.size;
  tr.insert(insertAt, para);
  // Without this, the transaction's own NodeSelection (still wrapping the
  // rule from before this fresh paragraph existed) is what the caret
  // inherits — confirmed live that typing against that stale selection
  // jumps to a different cell entirely rather than landing in the new
  // paragraph right next to it.
  tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 1), 1));
}

/**
 * Handles `---`/`___`/`***` closing into a horizontal rule. `horizontal_rule`
 * is a valid sibling wherever ordinary block content is (including inside a
 * table cell, which now holds real block content — see schema.ts):
 * `replaceRangeWith` splits the enclosing paragraph in two and inserts the
 * rule between the halves, exactly as it already does for a plain paragraph
 * outside any table — confirmed this stays schema-valid and doesn't disturb
 * the table's own structure (still one row, one cell, same column count).
 * See {@link keepCellTypableAfterHr} for the one follow-up fixup this needs.
 */
export function horizontalRuleHandler(s: Schema): RuleHandler {
  return (state, _match, start, end) => {
    const tr = state.tr.replaceRangeWith(start, end, s.nodes.horizontal_rule.create());
    keepCellTypableAfterHr(tr, s, tr.mapping.map(start));
    return tr;
  };
}

/**
 * Shift-Enter inserts a hard line break in the current block — the Slack/
 * Docs/Notion convention for "new line, not a new paragraph" — wherever the
 * schema allows one, table cell or not (`hard_break` ships as part of
 * `prosemirror-schema-basic`'s inline group, valid inside any textblock).
 * Returns `false` in a code block, where Shift-Enter falls through to the
 * browser's native newline-in-`<pre>` handling instead, same as plain Enter
 * already does via `newlineInCode`.
 */
export const insertHardBreak: Command = (state, dispatch) => {
  const br = state.schema.nodes.hard_break;
  if (!br || state.selection.$from.parent.type.spec.code) return false;
  if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
  return true;
};

/**
 * Tab in a plain paragraph — nowhere left in the chain to sink a list item
 * or move to another table cell — inserts a literal tab character instead
 * of falling through to the browser's default tab-out-of-the-editor
 * behavior. Tab must always mean something inside the editor (the same
 * restraint already applied to a table's own Tab handling, see
 * {@link tabAddsRowAtEnd}'s doc comment): a document editor that lets a
 * stray Tab press silently yank focus onto page chrome is a keyboard trap,
 * not a keyboard shortcut. Always handled, so it's the final entry in the
 * 'Tab' keymap chain.
 */
export const insertTabCharacter: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.insertText('\t').scrollIntoView());
  return true;
};

/**
 * Shift-Tab's mirror: removes a single tab character immediately before the
 * caret if one is there (undoing {@link insertTabCharacter}'s indent), and
 * swallows the key either way — never falling through to the browser's
 * reverse-tab-order default, which would be exactly the same focus-escape
 * `insertTabCharacter` exists to prevent, just in the other direction.
 */
export const removeTabCharacterBefore: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (empty && $from.parentOffset > 0 && $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset) === '\t') {
    if (dispatch) dispatch(state.tr.delete($from.pos - 1, $from.pos).scrollIntoView());
  }
  return true;
};

/**
 * Backspace at the very start of a table's top row (any column, any block
 * within the top-left cell) — reaching before the table's `isolating`
 * boundary (prosemirror-tables' own schema), which is exactly right for
 * preventing `baseKeymap`'s default `joinBackward` from welding a preceding
 * paragraph's text into table structure — but also means Backspace there
 * silently does nothing at all, with no way to reach or remove whatever
 * sits just above the table without first clicking directly on it. If the
 * preceding block is empty, delete it outright — the concrete case a user
 * actually wants Backspace for here (an unwanted blank line pinned directly
 * above the table, otherwise removable only by precisely clicking that
 * one-line target). If it has content, move the caret to its end instead of
 * merging anything — putting the caret exactly "in front of" the table,
 * from which a second, ordinary Backspace behaves normally. No-op with
 * nothing before the table at all (matches the default behavior at the
 * very start of the document). Uses {@link cellAround}/
 * {@link cellContentRange} rather than a fixed depth offset, since a cell
 * can now hold several blocks (see schema.ts) — "the very start of the
 * cell" is the start of its full content span, not just of whichever inner
 * block the caret happens to be in.
 */
export function backspaceAtTableStart(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const $cell = cellAround($from);
    if (!$cell) return false;
    const { start } = cellContentRange($cell);
    if ($from.pos !== start) return false;
    const rowDepth = $cell.depth;
    if ($cell.index(rowDepth - 1) !== 0) return false;

    const before = $cell.before(rowDepth - 1);
    const $before = state.doc.resolve(before);
    const prev = $before.nodeBefore;
    if (!prev) return false;

    if (dispatch) {
      const tr = state.tr;
      if (prev.isTextblock && prev.content.size === 0) {
        tr.delete(before - prev.nodeSize, before);
      } else {
        tr.setSelection(Selection.near(tr.doc.resolve(before), -1));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Forward-Delete at the very end of a table's bottom row — the mirror image
 * of {@link backspaceAtTableStart}, but for Delete instead of Backspace,
 * reaching forward past the table's `isolating` boundary instead of
 * backward. Without this, Delete at the end of the last cell silently does
 * nothing (`baseKeymap`'s default `joinForward` is blocked the same way
 * `joinBackward` is), with no way to reach or remove a stray blank paragraph
 * sitting directly after the table short of clicking it directly. If the
 * following block is empty, delete it outright; if it has content, move the
 * caret to its start instead of merging anything — putting the caret
 * exactly "behind" the table, from which a second, ordinary Delete behaves
 * normally. No-op with nothing after the table at all.
 */
export function deleteAtTableEnd(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const $cell = cellAround($from);
    if (!$cell) return false;
    const { end } = cellContentRange($cell);
    if ($from.pos !== end) return false;
    const rowDepth = $cell.depth;
    const table = $cell.node(rowDepth - 1);
    if ($cell.index(rowDepth - 1) !== table.childCount - 1) return false;

    const after = $cell.after(rowDepth - 1);
    const $after = state.doc.resolve(after);
    const next = $after.nodeAfter;
    if (!next) return false;

    if (dispatch) {
      const tr = state.tr;
      if (next.isTextblock && next.content.size === 0) {
        tr.delete(after, after + next.nodeSize);
      } else {
        tr.setSelection(Selection.near(tr.doc.resolve(after), 1));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Remembers which table column a vertical Arrow move last left from, so
 * arrowing back into the table from the paragraph above/below (see
 * {@link tableArrowFromOutside}) returns to that same column instead of
 * always landing in a fixed corner cell. A freshly-created escape
 * paragraph is empty, so its caret always renders at the block's own left
 * edge regardless of which column was left — there's no x-position of its
 * own to read the target column back out of. This is the same "goal
 * column" idea code editors use to preserve a horizontal position across
 * differently-shaped lines, applied across a table boundary instead.
 * Cleared by any selection change that didn't come through
 * {@link tableArrowVertical}/{@link tableArrowFromOutside} themselves — a
 * click, a horizontal arrow, typing — so stale memory never leaks into an
 * unrelated later vertical move.
 */
export const tableGoalColumnKey = new PluginKey<number | null>('tableGoalColumn');

export function tableGoalColumnPlugin(): Plugin {
  return new Plugin({
    key: tableGoalColumnKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(tableGoalColumnKey);
        if (meta !== undefined) return meta;
        if (tr.selectionSet) return null;
        return value;
      },
    },
  });
}

/**
 * The content-start position of the cell at `(targetRow, col)` in `table`,
 * given the doc position of the boundary a vertical Arrow move is crossing
 * — shared between {@link tableArrowVertical} (escaping into a
 * *neighbouring table* sitting directly against this one, no paragraph in
 * between) and {@link tableArrowFromOutside} (entering from a plain
 * textblock). Without this shared column math, two adjacent tables would
 * silently lose the remembered goal column the moment the "neighbour" is a
 * table instead of a paragraph — `Selection.near` has no notion of
 * "same column", so it would just land wherever document order first
 * offers a valid selection (the first cell), the same inconsistency
 * {@link tableGoalColumnKey} exists to avoid everywhere else.
 */
function adjacentTableCellPos(table: PMNode, boundary: number, dir: 1 | -1, col: number): number {
  const map = TableMap.get(table);
  const tableStart = (dir === -1 ? boundary - table.nodeSize : boundary) + 1;
  const targetRow = dir === -1 ? map.height - 1 : 0;
  const clampedCol = Math.min(col, map.width - 1);
  return tableStart + map.positionAt(targetRow, clampedCol, table);
}

/**
 * The full content span of the cell `cellAround` found — from just after
 * the cell node opens to just before it closes — spanning every nested
 * block inside it, not just the caret's own immediate textblock. Comparing
 * a position against `start`/`end` is how {@link tableArrowVertical} and
 * {@link tableArrowHorizontal} tell "at the true edge of the *cell*" apart
 * from "at the edge of one paragraph among several in the same cell" now
 * that cells hold real block content (see schema.ts).
 */
function cellContentRange($cell: ResolvedPos): { start: number; end: number } {
  const node = $cell.nodeAfter;
  const start = $cell.pos + 1;
  return { start, end: start + (node ? node.content.size : 0) };
}

/**
 * ArrowUp/ArrowDown move between cells vertically (same column, row above
 * or below) — but only once the caret has nowhere further to go *within*
 * the current cell: table cells hold real block content (paragraphs,
 * lists, headings — see schema.ts), so a cell can now span several lines,
 * and ArrowDown from its first paragraph must move to its second paragraph
 * before ever reaching the row below. `cellContentRange` gives the cell's
 * full content span (every nested block, not just the caret's own
 * immediate textblock); only a caret sitting exactly at that span's start
 * (dir -1) or end (dir 1) counts as "at the cell's true edge" — anywhere
 * else falls through (`return false`) to ordinary vertical caret movement,
 * which already handles moving between lines/blocks within one cell
 * correctly (cells are `isolating`, so it can't leak out of the cell by
 * itself). This intentionally doesn't chase the *visual* last line of a
 * wrapped paragraph the way prosemirror-tables' own (unexported)
 * `atEndOfCell` does via `view.endOfTextblock` — a structural check alone
 * is exactly right for the overwhelmingly common case (single short line,
 * or the caret literally at the last character) and needs no live
 * `EditorView` to test; the one narrow gap is a caret on the *bottom*
 * visual line of a wrapped paragraph but not at its very last character,
 * which falls through to native handling instead of escaping the cell —
 * a minor imprecision, not a correctness bug.
 *
 * At the table's top/bottom edge, moves into whatever block already sits
 * next to the table (regardless of *which* column, matching Word/Docs/
 * Excel — arrowing up from anywhere in the top row exits above, not just
 * the first cell) — but never *creates* one: Arrow keys are pure
 * navigation everywhere else in the editor (arrowing past the start/end of
 * the document just stops) and silently mutating the document on a plain
 * caret move would be exactly the kind of surprise that convention exists
 * to avoid. With nothing to move into, this simply does nothing, same as
 * arrowing at the document's own start/end. Records the column being left
 * in {@link tableGoalColumnKey} whenever it does move, so a later
 * escape-then-return round trip lands back in the same column.
 */
export function tableArrowVertical(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const $head = selection.$head;
    const $cell = cellAround($head);
    if (!$cell) return false;
    const { start, end } = cellContentRange($cell);
    if (dir === -1 ? $head.pos !== start : $head.pos !== end) return false;
    const table = $cell.node(-1);
    const map = TableMap.get(table);
    const tableStart = $cell.start(-1);
    const colIndex = map.findCell($cell.pos - tableStart).left;
    const $next = nextCell($cell, 'vert', dir);
    if ($next) {
      if (dispatch) {
        dispatch(
          state.tr
            .setSelection(Selection.near($next, 1))
            .setMeta(tableGoalColumnKey, colIndex)
            .scrollIntoView()
        );
      }
      return true;
    }
    const boundary = dir === -1 ? $cell.before(-1) : $cell.after(-1);
    const $boundary = state.doc.resolve(boundary);
    const hasNeighbour = dir === -1 ? $boundary.nodeBefore : $boundary.nodeAfter;
    // Nothing to escape into (the table opens/closes the doc): swallow the
    // event rather than return false — falling through would hand the key
    // to prosemirror-tables' own vertical-arrow handler (registered later,
    // by tableEditing()), which would otherwise mimic horizontal movement
    // instead of doing nothing, the one behavior a boundary arrow-press
    // should have.
    if (!hasNeighbour) return true;
    if (dispatch) {
      const tr = state.tr;
      // A neighbouring *table* (two tables with no paragraph between them)
      // needs the same column-aware entry as tableArrowFromOutside — a bare
      // Selection.near has no notion of "same column" and would always land
      // in the first cell, silently dropping the goal column right at the
      // one boundary shape this file otherwise takes care to preserve it
      // across.
      const pos = hasNeighbour.type === table.type.schema.nodes.table
        ? adjacentTableCellPos(hasNeighbour, boundary, dir, colIndex) + 1
        : boundary + dir;
      tr.setSelection(Selection.near(tr.doc.resolve(pos), dir))
        .setMeta(tableGoalColumnKey, colIndex)
        .scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

/**
 * ArrowLeft/ArrowRight at the table's outer horizontal boundary — the very
 * start of the first cell (top-left), or the very end of the last cell
 * (bottom-right) — escapes instead of leaving the browser's native caret
 * movement to improvise there. Ordinary cell-to-cell movement, and ordinary
 * movement *between blocks within one cell* now that cells hold real block
 * content (see schema.ts), already work correctly without any help here —
 * moving from the end of one paragraph to the start of the next is native
 * document-flow behavior everywhere, table cell or not (cells are
 * `isolating`, so it can't leak past the cell either way). Only the true
 * outer corners of the whole cell — `cellContentRange`'s `start`/`end`, not
 * just the caret's own immediate textblock's edge — are actually broken:
 * with no further position for the *browser's* native caret to move to, the
 * fallback behaviour (browser- and position-dependent, not anything this
 * app codes) has been observed to either wrap the caret back to the first
 * cell (ArrowRight, no neighbour) or escape the ProseMirror view entirely
 * onto unrelated page chrome, silently swallowing the next keystroke
 * (ArrowRight, WITH a neighbouring paragraph) — both confirmed live. Same
 * shape and same restraint as {@link tableArrowVertical}: moves into an
 * existing neighbouring block if there is one, otherwise swallows the key
 * and does nothing (arrows are pure navigation, never an insert gesture).
 */
export function tableArrowHorizontal(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const $head = selection.$head;
    const $cell = cellAround($head);
    if (!$cell) return false;
    const { start, end } = cellContentRange($cell);
    if (dir === -1 ? $head.pos !== start : $head.pos !== end) return false;
    const table = $cell.node(-1);
    const map = TableMap.get(table);
    const tableStart = $cell.start(-1);
    const rect = map.findCell($cell.pos - tableStart);
    const atOuterCorner = dir === -1 ? rect.left === 0 && rect.top === 0 : rect.right === map.width && rect.bottom === map.height;
    if (!atOuterCorner) return false;

    const boundary = dir === -1 ? $cell.before(-1) : $cell.after(-1);
    const $boundary = state.doc.resolve(boundary);
    const hasNeighbour = dir === -1 ? $boundary.nodeBefore : $boundary.nodeAfter;
    if (!hasNeighbour) return true; // swallow — nothing to move into, same restraint as tableArrowVertical
    if (dispatch) {
      dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(boundary + dir), dir)).scrollIntoView());
    }
    return true;
  };
}

/**
 * ArrowUp/ArrowDown from a plain textblock directly adjacent to a table —
 * the counterpart to {@link tableArrowVertical}'s escape branch, entering
 * the table instead of leaving it. Without this, entering is left to the
 * browser's native Up/Down fallback, which (same underlying cause as
 * `tableArrowVertical`'s doc comment — no real spatial reasoning across a
 * table's row boundaries) consistently lands in the table's last cell
 * regardless of where the caret actually was. Reads
 * {@link tableGoalColumnKey}'s remembered column when set (the common
 * case: arrowing back into a table just escaped from), defaulting to the
 * first column otherwise.
 */
export function tableArrowFromOutside(dir: 1 | -1): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const $head = selection.$head;
    if (cellAround($head)) return false;
    if (!view.endOfTextblock(dir < 0 ? 'up' : 'down')) return false;
    const depth = $head.depth;
    const boundary = dir < 0 ? $head.before(depth) : $head.after(depth);
    const $boundary = state.doc.resolve(boundary);
    const table = dir < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
    if (!table || table.type !== state.schema.nodes.table) return false;
    const goalColumn = tableGoalColumnKey.getState(state);
    const col = goalColumn ?? 0;
    const cellPos = adjacentTableCellPos(table, boundary, dir < 0 ? -1 : 1, col);
    if (dispatch) {
      dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(cellPos + 1), 1)).scrollIntoView());
    }
    return true;
  };
}

/**
 * Shift-Arrow(Up/Down/Left/Right) extends (or starts) a `CellSelection` —
 * the mouse-drag equivalent for keyboard users. prosemirror-tables' own
 * `shiftArrow` is gated behind the same `atEndOfCell` check described on
 * {@link tableArrowVertical} (broken for our flatter, wrapper-paragraph-
 * less cells), so it never fires for us on any axis; without it, Shift-
 * Arrow falls through to the browser's own native cross-cell selection
 * extension, which is unreliable (observed flaky even for the horizontal
 * axis in testing — sometimes extending a `CellSelection`, sometimes
 * doing nothing). `nextCell` via `TableMap` sidesteps `atEndOfCell`
 * entirely and is deterministic on every axis, mirroring the library's
 * own `shiftArrow` shape.
 */
export function tableShiftArrow(axis: 'horiz' | 'vert', dir: 1 | -1): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    let anchorCell;
    let headCell;
    if (sel instanceof CellSelection) {
      anchorCell = sel.$anchorCell;
      headCell = sel.$headCell;
    } else {
      if (!(sel instanceof TextSelection) || !sel.empty) return false;
      const $cell = cellAround(sel.$head);
      if (!$cell) return false;
      anchorCell = $cell;
      headCell = $cell;
    }
    const $next = nextCell(headCell, axis, dir);
    if (!$next) return false;
    if (dispatch) dispatch(state.tr.setSelection(new CellSelection(anchorCell, $next)));
    return true;
  };
}

/**
 * Wraps a table-structure command so its transaction always starts a fresh
 * undo step, never silently merging backward into whatever happened just
 * before it. Undo/redo here goes through Yjs's `UndoManager` (see
 * `yUndoPlugin` in Editor.svelte), which coalesces consecutive changes
 * within a short time window (~500ms) the same way it coalesces keystrokes
 * into word-ish chunks — right for typing, but wrong for a discrete,
 * repeatable structural edit: mashing "add row" five times quickly and then
 * undoing once must undo exactly one row, not silently merge five additions
 * (or five deletions) into a single step. `stopCapturing()` resets that
 * merge window immediately before the command's own transaction is
 * captured, so it can never merge with whatever preceded it — a no-op
 * outside a real collab session (no `yUndoPlugin` installed, e.g. in tests).
 */
function freshUndoStep(cmd: Command): Command {
  return (state, dispatch, view) => {
    if (dispatch) yUndoPluginKey.getState(state)?.undoManager.stopCapturing();
    return cmd(state, dispatch, view);
  };
}

export const addRowAfter = freshUndoStep(addRowAfterRaw);
export const addColumnAfter = freshUndoStep(addColumnAfterRaw);
export const deleteRow = freshUndoStep(deleteRowRaw);
export const deleteColumn = freshUndoStep(deleteColumnRaw);
export const toggleHeaderRow = freshUndoStep(toggleHeaderRowRaw);

/**
 * Tab in the very last cell of a table's last row adds a new row and moves
 * into its first cell, instead of doing nothing (`goToNextCell(1)` returns
 * `false` there — there's no next cell to go to). Matches Google Docs
 * exactly (confirmed against Google's own support docs): Tab at the last
 * cell keeps you typing by growing the table, the same way Tab at the end
 * of the last row of a spreadsheet does — and, also matching Docs,
 * repeating it keeps adding rows one at a time.
 *
 * That last part is also the one documented irritant of this exact
 * convention (see e.g. long-running "stop Tab from adding a row" threads
 * for Word): tabbing through an already-empty last row for any other
 * reason (habit, a stray extra press) piles up empty rows with no way to
 * ask for one back short of the mouse. Since an empty row is already
 * available to type into, growing the table further only makes sense once
 * that row actually has content — so this only fires when the *current*
 * last row isn't entirely empty, a small deliberate deviation from strict
 * Docs parity in favor of not compounding an accidental keystroke. Still
 * swallows the key when it declines to grow the table (returns `true` with
 * nothing dispatched) rather than returning `false` — falling through to
 * the browser's own default Tab handling here would tab focus *out of the
 * editor entirely*, undoing the very thing Tab-adds-row exists to prevent
 * (Tab always meaning something inside a table, never an escape hatch).
 */
export function tabAddsRowAtEnd(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const $cell = cellAround($from);
    if (!$cell) return false;
    const { end } = cellContentRange($cell);
    if ($from.pos !== end) return false;
    const rowDepth = $cell.depth;
    const row = $cell.node(rowDepth);
    const table = $cell.node(rowDepth - 1);
    if ($cell.index(rowDepth) !== row.childCount - 1 || $cell.index(rowDepth - 1) !== table.childCount - 1) {
      return false;
    }
    if (!row.textContent) return true;
    if (!dispatch) return true;
    const tablePos = $cell.before(rowDepth - 1);
    return addRowAfter(state, (tr) => {
      const grownTable = tr.doc.nodeAt(tablePos);
      if (!grownTable) return;
      let lastRowStart = tablePos + 1;
      for (let i = 0; i < grownTable.childCount - 1; i += 1) lastRowStart += grownTable.child(i).nodeSize;
      tr.setSelection(Selection.near(tr.doc.resolve(lastRowStart + 2), 1));
      dispatch(tr.scrollIntoView());
    });
  };
}

export function buildPlugins(s: Schema): Plugin[] {
  return [
    keymap({
      'Mod-b': toggleMark(s.marks.strong),
      'Mod-i': toggleMark(s.marks.em),
      // Mod-` (and Mod-Shift-`) are macOS-reserved system-wide for cycling
      // windows of the front app — no browser ever sees the keystroke, so
      // toggling code on that binding silently does nothing on a Mac.
      'Mod-Shift-c': toggleMark(s.marks.code),
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
      // toolbar is never the only way to reach these while writing. All are
      // toggles: re-pressing the active one reverts to a plain paragraph, so
      // there's always a keyboard path back to body text (matches Docs/Notion,
      // and stops blockquote nesting forever on repeated Mod-Shift-9).
      'Mod-Alt-0': setBlockType(s.nodes.paragraph),
      'Mod-Alt-1': toggleHeading(s.nodes.heading, s.nodes.paragraph, 1),
      'Mod-Alt-2': toggleHeading(s.nodes.heading, s.nodes.paragraph, 2),
      'Mod-Alt-3': toggleHeading(s.nodes.heading, s.nodes.paragraph, 3),
      'Mod-Alt-c': toggleBlockType(s.nodes.code_block, s.nodes.paragraph),
      // 6 slots in next to 7/8/9 (ordered/bullet/quote) for the one other
      // list-shaped block type — checklist.
      'Mod-Shift-6': toggleList(s.nodes.task_list, s.nodes.task_item),
      'Mod-Shift-7': toggleList(s.nodes.ordered_list, s.nodes.list_item),
      'Mod-Shift-8': toggleList(s.nodes.bullet_list, s.nodes.list_item),
      'Mod-Shift-9': toggleWrap(s.nodes.blockquote),
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      'Escape': escapeCodeBlock,
      'ArrowUp': chainCommands(tableArrowVertical(-1), tableArrowFromOutside(-1)),
      'ArrowDown': chainCommands(exitCodeBlockDown, tableArrowVertical(1), tableArrowFromOutside(1)),
      'ArrowLeft': tableArrowHorizontal(-1),
      'ArrowRight': tableArrowHorizontal(1),
      'Shift-ArrowUp': tableShiftArrow('vert', -1),
      'Shift-ArrowDown': tableShiftArrow('vert', 1),
      'Shift-ArrowLeft': tableShiftArrow('horiz', -1),
      'Shift-ArrowRight': tableShiftArrow('horiz', 1),
      // The task_item split passes an explicit `checked: false` for the new
      // item — splitListItem otherwise copies the *original* item's attrs
      // onto both halves, so pressing Enter on a checked item would silently
      // hand the brand-new row a pre-ticked checkbox. Enter inside a table
      // cell now falls all the way through to baseKeymap's own splitBlock
      // (registered separately, later, see below) — cells hold real block
      // content (schema.ts), so Enter there behaves like ordinary paragraph
      // splitting everywhere else, matching Notion/Docs (no more swallow-or-
      // escape special case: Arrow keys already handle leaving the table,
      // see tableArrowVertical/tableArrowHorizontal above).
      'Enter': chainCommands(
        exitCodeBlockOnBlankLine,
        splitListItem(s.nodes.list_item),
        splitListItem(s.nodes.task_item, { checked: false })
      ),
      'Shift-Enter': insertHardBreak,
      // A CellSelection + Backspace/Delete falls through to baseKeymap's
      // `deleteSelection`, which clears the selected cells' *content* and
      // leaves the table structure intact — the Word/Docs/Notion convention.
      // Deleting whole rows/columns is a deliberate, separate action reached
      // via Alt-Shift-Backspace / Mod-Alt-Shift-Backspace or the table
      // panel's own buttons, never a bare Backspace over a cell range.
      'Backspace': chainCommands(backspaceAtTableStart(), clearEmptyCodeBlockBackward),
      'Delete': deleteAtTableEnd(),
      'Tab': chainCommands(
        goToNextCell(1),
        tabAddsRowAtEnd(),
        sinkListItem(s.nodes.list_item),
        sinkListItem(s.nodes.task_item),
        insertTabCharacter
      ),
      'Shift-Tab': chainCommands(
        goToNextCell(-1),
        liftListItem(s.nodes.list_item),
        liftListItem(s.nodes.task_item),
        removeTabCharacterBefore
      ),
      // Direct keyboard access to table-structure edits — reaching the
      // floating table panel first (Shift-F10, then Tab to the right
      // button) works, but is real friction for a common, repeated action
      // like removing a row. These are plain prosemirror-tables commands,
      // which already no-op outside a table, bound straight to the keymap
      // (the same reliability class as Tab/Enter/Arrow here — unlike a
      // DOM-level keydown listener racing a browser/OS-level binding, see
      // the removed Alt-Enter toolbar shortcut this replaced).
      //
      // Row/column add share a letter mnemonic (R/C) written as an
      // EXPLICIT `Alt-Shift-<lowercase letter>`, not the capitalized
      // `Alt-R` shorthand it might look equivalent to — the two are NOT
      // interchangeable. `prosemirror-keymap` (`w3c-keyname`) matches
      // primarily against the literal character `event.key` produces; for
      // a single shifted letter it also retries via `event.keyCode`
      // whenever that differs in case from `event.key` (its own built-in
      // fallback for exactly this class of platform quirk) — and that
      // retry always reconstructs the binding as `Shift-Alt-<lowercase>`,
      // never as `Alt-<UPPERCASE>`. On Windows/Linux this fallback fires
      // too (browsers report the shifted, uppercase letter in `event.key`
      // even there) and happens to still resolve either way — but on
      // macOS, Option+Shift+<letter> can compose into an entirely
      // unrelated accented/special character in `event.key` depending on
      // keyboard layout (confirmed live for at least one real combination
      // this session), at which point `Alt-R` has nothing left to match:
      // the direct comparison fails against the composed character, and
      // the fallback path — the only thing that could still save it — only
      // ever reconstructs the `Shift-Alt-r` shape. Verified directly
      // against `prosemirror-keymap`'s own `keydownHandler`: `Alt-R` matches
      // a plain `event.key === 'R'` but not a composed character, while
      // `Alt-Shift-r` matches both. Delete reuses Backspace — a layout-
      // independent key, unlike Shift-punctuation such as `-`, which
      // produces a different character across keyboard layouts — with Mod
      // toggling which axis, mirroring Tab/Shift-Tab's own "same key, one
      // modifier changes direction" shape (Backspace isn't a printable
      // character, so it isn't subject to any of the above — `Alt-Shift-
      // Backspace` matches directly on every platform without needing the
      // fallback at all). No bare shortcut for deleting the whole table:
      // that's a single keystroke destroying much more than one row, so it
      // stays behind the toolbar panel's own trash-icon button (a bare
      // Backspace over a cell selection only *clears* content, matching
      // Word/Docs — see the Backspace binding above).
      'Alt-Shift-r': addRowAfter,
      'Alt-Shift-c': addColumnAfter,
      'Alt-Shift-Backspace': deleteRow,
      'Mod-Alt-Shift-Backspace': deleteColumn,
      'Alt-Shift-h': toggleHeaderRow,
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
        new InputRule(HORIZONTAL_RULE_RULE, horizontalRuleHandler(s)),
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
    tableGoalColumnPlugin(),
  ];
}
