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
 * Handles `---`/`___`/`***` closing into a horizontal rule. Every other
 * block-creating rule above (`textblockTypeInputRule`, `wrappingInputRule`)
 * already no-ops harmlessly inside a table cell — verified live — because
 * `setBlockType`/`wrapIn` check whether the target type actually fits at the
 * position before doing anything. This one doesn't have that guard:
 * `replaceRangeWith` just tries to fit a `horizontal_rule` (a `block`,
 * invalid inside a cell's `inline*` content) wherever it can, and
 * ProseMirror's transform machinery obliges by splitting the table itself in
 * two to make room — corrupting it (the split-off piece is missing columns)
 * with no way to rejoin by deleting the rule afterward. Guard explicitly.
 */
export function horizontalRuleHandler(s: Schema): RuleHandler {
  return (state, _match, start, end) => {
    if (cellAround(state.doc.resolve(start))) return null;
    return state.tr.replaceRangeWith(start, end, s.nodes.horizontal_rule.create());
  };
}

/** Swallow Enter inside a table cell instead of letting `baseKeymap`'s
 *  `splitBlock` split the cell itself in two — GFM-shaped cells are
 *  single-line (`cellContent: 'inline*'`, see schema.ts), so there's no
 *  "new paragraph within the cell" to make room for. Only reached once
 *  {@link exitTableAtBoundary} has already ruled out an actual escape. */
function preventEnterInTableCell(s: Schema): Command {
  return (state) => {
    const { parent } = state.selection.$from;
    return parent.type === s.nodes.table_cell || parent.type === s.nodes.table_header;
  };
}

/**
 * Shift-Enter inserts a hard line break in the current block — the Slack/
 * Docs/Notion convention for "new line, not a new paragraph" — wherever the
 * schema allows one. `hard_break` ships as part of `prosemirror-schema-basic`'s
 * inline group, so it's already valid inside a GFM table cell's `inline*`
 * content (see schema.ts) without any schema change; this is what actually
 * wires it up, as the one schema-safe middle ground between swallowing Enter
 * in a cell entirely and allowing full multi-paragraph cells (which would
 * break lossless GFM round-trip — see the markdown codec's `cellText`).
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
 * Enter at the very start of any cell in a table's top row, or the very end
 * of any cell in its bottom row, escapes the table instead of being
 * swallowed like every other Enter inside a cell (see
 * {@link preventEnterInTableCell}) — otherwise a table that opens or closes
 * the document traps the caret with no keyboard way out (cells can't grow a
 * new line to push past it, unlike a paragraph). Keyed off `rowIndex` only
 * (top/bottom), not `cellIndex`, matching {@link tableArrowVertical}'s
 * escape branch — arrowing up from anywhere in the top row already exits
 * above (the Word/Docs/Excel convention), so Enter doing the same only from
 * the literal corner cell would be an inconsistency a keyboard user could
 * easily notice. Moves into whichever block already sits next to the table
 * if there is one, or inserts a fresh paragraph there otherwise — the same
 * "reuse a neighbour, else make one" shape as {@link exitCodeBlock}, just
 * usable in both directions since a table (unlike a code block) can trap
 * the caret from either end.
 */
export function exitTableAtBoundary(s: Schema, dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const depth = $from.depth;
    const cell = depth >= 0 ? $from.node(depth) : null;
    if (cell?.type !== s.nodes.table_cell && cell?.type !== s.nodes.table_header) return false;
    if (depth < 2) return false;
    const table = $from.node(depth - 2);
    const rowIndex = $from.index(depth - 2);

    if (dir === -1) {
      if ($from.parentOffset !== 0 || rowIndex !== 0) return false;
    } else {
      if ($from.parentOffset !== cell.content.size || rowIndex !== table.childCount - 1) return false;
    }

    if (dispatch) {
      const tr = state.tr;
      const boundary = dir === -1 ? $from.before(depth - 2) : $from.after(depth - 2);
      const $boundary = tr.doc.resolve(boundary);
      const hasNeighbour = dir === -1 ? $boundary.nodeBefore : $boundary.nodeAfter;
      if (!hasNeighbour) {
        const para = s.nodes.paragraph.createAndFill();
        if (!para) return false;
        tr.insert(boundary, para);
      }
      const pos = hasNeighbour ? boundary + dir : boundary + 1;
      tr.setSelection(Selection.near(tr.doc.resolve(pos), dir));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Backspace at the very start of any cell in a table's top row — the mirror
 * image of {@link exitTableAtBoundary}'s dir=-1 case, but for Backspace
 * instead of Enter, and (like {@link tableArrowVertical}) not limited to
 * the literal first cell. A table is `isolating` (prosemirror-tables' own
 * schema), which is exactly right for preventing `baseKeymap`'s default
 * `joinBackward` from welding a preceding paragraph's text into table
 * structure — but it also means Backspace there silently does nothing at
 * all, with no way to reach or remove whatever sits just above the table
 * without first clicking directly on it. If the preceding block is empty,
 * delete it outright — the concrete case a user actually wants Backspace
 * for here (an unwanted blank line pinned directly above the table,
 * otherwise removable only by precisely clicking that one-line target). If
 * it has content, move the caret to its end instead of merging anything —
 * putting the caret exactly "in front of" the table, from which a second,
 * ordinary Backspace behaves normally. No-op with nothing before the table
 * at all (matches the default behavior at the very start of the document).
 */
export function backspaceAtTableStart(s: Schema): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parentOffset !== 0) return false;
    const depth = $from.depth;
    const cell = depth >= 0 ? $from.node(depth) : null;
    if (cell?.type !== s.nodes.table_cell && cell?.type !== s.nodes.table_header) return false;
    if (depth < 2) return false;
    if ($from.index(depth - 2) !== 0) return false;

    const before = $from.before(depth - 2);
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
 * Forward-Delete at the very end of any cell in a table's bottom row — the
 * mirror image of {@link backspaceAtTableStart}, but for Delete instead of
 * Backspace, reaching forward past the table's `isolating` boundary instead
 * of backward. Without this, Delete at the end of the last cell silently
 * does nothing (`baseKeymap`'s default `joinForward` is blocked the same way
 * `joinBackward` is), with no way to reach or remove a stray blank paragraph
 * sitting directly after the table short of clicking it directly. If the
 * following block is empty, delete it outright; if it has content, move the
 * caret to its start instead of merging anything — putting the caret
 * exactly "behind" the table, from which a second, ordinary Delete behaves
 * normally. No-op with nothing after the table at all.
 */
export function deleteAtTableEnd(s: Schema): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const depth = $from.depth;
    const cell = depth >= 0 ? $from.node(depth) : null;
    if (cell?.type !== s.nodes.table_cell && cell?.type !== s.nodes.table_header) return false;
    if (depth < 2) return false;
    if ($from.parentOffset !== cell.content.size) return false;
    const table = $from.node(depth - 2);
    if ($from.index(depth - 2) !== table.childCount - 1) return false;

    const after = $from.after(depth - 2);
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
 * ArrowUp/ArrowDown move between cells vertically (same column, row above
 * or below) — prosemirror-tables' own vertical-arrow heuristic
 * (`atEndOfCell`) assumes the library's default `block+` cell content
 * model (cell → paragraph → inline), one depth level deeper than our
 * `cellContent: 'inline*'` cells (see schema.ts, a deliberate GFM-shaped
 * choice: no wrapping paragraph). Its ancestor walk looks for a
 * `cell`/`header_cell` node exactly one level above the caret's textblock,
 * which for our flatter schema is the *row*, not a cell — so the check
 * never resolves, silently falls through to the browser's native Up/Down
 * handling, which (crossing a table's row boundaries) ends up reading as
 * "the same as Left/Right" instead of true vertical movement. Since a
 * cell here is *always* exactly one line — wrapping is impossible — there
 * is no visual-line ambiguity to resolve in the first place; go straight
 * to `nextCell` via `TableMap`. At the table's top/bottom edge, moves into
 * whatever block already sits next to the table (regardless of *which*
 * column, matching Word/Docs/Excel — arrowing up from anywhere in the top
 * row exits above, not just the first cell) — but, unlike
 * {@link exitTableAtBoundary}'s Enter handling, never *creates* one: Enter
 * is inherently an insert gesture, so conjuring a paragraph there is
 * expected, but Arrow keys are pure navigation everywhere else in the
 * editor (arrowing past the start/end of the document just stops) and
 * silently mutating the document on a plain caret move would be exactly
 * the kind of surprise that convention exists to avoid. With nothing to
 * move into, this simply does nothing, same as arrowing at the document's
 * own start/end. Records the column being left in
 * {@link tableGoalColumnKey} whenever it does move, so a later
 * escape-then-return round trip lands back in the same column.
 */
export function tableArrowVertical(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const $cell = cellAround(selection.$head);
    if (!$cell) return false;
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
    // by tableEditing()), which is broken for this schema (see this
    // function's doc comment) and ends up mimicking horizontal movement
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
export function tabAddsRowAtEnd(s: Schema): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const depth = $from.depth;
    const cell = depth >= 0 ? $from.node(depth) : null;
    if (cell?.type !== s.nodes.table_cell && cell?.type !== s.nodes.table_header) return false;
    if (depth < 2) return false;
    const row = $from.node(depth - 1);
    const table = $from.node(depth - 2);
    if ($from.index(depth - 1) !== row.childCount - 1 || $from.index(depth - 2) !== table.childCount - 1) {
      return false;
    }
    if (!row.textContent) return true;
    if (!dispatch) return true;
    const tablePos = $from.before(depth - 2);
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
      'Shift-ArrowUp': tableShiftArrow('vert', -1),
      'Shift-ArrowDown': tableShiftArrow('vert', 1),
      'Shift-ArrowLeft': tableShiftArrow('horiz', -1),
      'Shift-ArrowRight': tableShiftArrow('horiz', 1),
      // The task_item split passes an explicit `checked: false` for the new
      // item — splitListItem otherwise copies the *original* item's attrs
      // onto both halves, so pressing Enter on a checked item would silently
      // hand the brand-new row a pre-ticked checkbox.
      'Enter': chainCommands(
        exitTableAtBoundary(s, -1),
        exitTableAtBoundary(s, 1),
        preventEnterInTableCell(s),
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
      'Backspace': chainCommands(backspaceAtTableStart(s), clearEmptyCodeBlockBackward),
      'Delete': deleteAtTableEnd(s),
      'Tab': chainCommands(
        goToNextCell(1),
        tabAddsRowAtEnd(s),
        sinkListItem(s.nodes.list_item),
        sinkListItem(s.nodes.task_item)
      ),
      'Shift-Tab': chainCommands(
        goToNextCell(-1),
        liftListItem(s.nodes.list_item),
        liftListItem(s.nodes.task_item)
      ),
      // Direct keyboard access to table-structure edits — reaching the
      // floating table panel first (Shift-F10, then Tab to the right
      // button) works, but is real friction for a common, repeated action
      // like removing a row. These are plain prosemirror-tables commands,
      // which already no-op outside a table, bound straight to the keymap
      // (the same reliability class as Tab/Enter/Arrow here — unlike a
      // DOM-level keydown listener racing a browser/OS-level binding, see
      // the removed Alt-Enter toolbar shortcut this replaced). Row/column
      // add share a letter mnemonic (R/C, capitalized rather than written
      // as an explicit Shift- modifier — prosemirror-keymap matches a
      // letter binding against the literal character `event.key` produces,
      // which is already uppercase once Shift is held, so `Alt-Shift-r`
      // silently never matches; `Alt-R` is the documented way to require
      // Shift on a letter key); delete reuses Backspace — a layout-
      // independent key, unlike Shift-punctuation such as `-`, which
      // produces a different character across keyboard layouts — with Mod
      // toggling which axis, mirroring Tab/Shift-Tab's own "same key, one
      // modifier changes direction" shape. No bare shortcut for deleting
      // the whole table: that's a single keystroke destroying much more
      // than one row, so it stays behind the toolbar panel's own trash-icon
      // button (a bare Backspace over a cell selection only *clears* content,
      // matching Word/Docs — see the Backspace binding above).
      'Alt-R': addRowAfter,
      'Alt-C': addColumnAfter,
      'Alt-Shift-Backspace': deleteRow,
      'Mod-Alt-Shift-Backspace': deleteColumn,
      'Alt-H': toggleHeaderRow,
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
