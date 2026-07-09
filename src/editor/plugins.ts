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
import { findWrapping } from 'prosemirror-transform';
import {
  goToNextCell,
  columnResizing,
  tableEditing,
  addRowAfter,
  CellSelection,
  selectedRect,
  deleteTable,
  cellAround,
  nextCell,
} from 'prosemirror-tables';
import type { MarkType, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
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
 * Enter at the very start of a table's first cell, or the very end of its
 * last cell, escapes the table instead of being swallowed like every other
 * Enter inside a cell (see {@link preventEnterInTableCell}) — otherwise a
 * table that opens or closes the document traps the caret with no keyboard
 * way out (cells can't grow a new line to push past it, unlike a paragraph).
 * Moves into whichever block already sits next to the table if there is
 * one, or inserts a fresh paragraph there otherwise — the same "reuse a
 * neighbour, else make one" shape as {@link exitCodeBlock}, just usable in
 * both directions since a table (unlike a code block) can trap the caret
 * from either end.
 */
export function exitTableAtBoundary(s: Schema, dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const depth = $from.depth;
    const cell = depth >= 0 ? $from.node(depth) : null;
    if (cell?.type !== s.nodes.table_cell && cell?.type !== s.nodes.table_header) return false;
    if (depth < 2) return false;
    const row = $from.node(depth - 1);
    const table = $from.node(depth - 2);
    const cellIndex = $from.index(depth - 1);
    const rowIndex = $from.index(depth - 2);

    if (dir === -1) {
      if ($from.parentOffset !== 0 || cellIndex !== 0 || rowIndex !== 0) return false;
    } else {
      if (
        $from.parentOffset !== cell.content.size ||
        cellIndex !== row.childCount - 1 ||
        rowIndex !== table.childCount - 1
      ) {
        return false;
      }
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
 * Backspace at the very start of a table's first cell — the mirror image of
 * {@link exitTableAtBoundary}'s dir=-1 case, but for Backspace instead of
 * Enter. A table is `isolating` (prosemirror-tables' own schema), which is
 * exactly right for preventing `baseKeymap`'s default `joinBackward` from
 * welding a preceding paragraph's text into table structure — but it also
 * means Backspace there silently does nothing at all, with no way to reach
 * or remove whatever sits just above the table without first clicking
 * directly on it. If the preceding block is empty, delete it outright — the
 * concrete case a user actually wants Backspace for here (an unwanted blank
 * line pinned directly above the table, otherwise removable only by
 * precisely clicking that one-line target). If it has content, move the
 * caret to its end instead of merging anything — putting the caret exactly
 * "in front of" the table, from which a second, ordinary Backspace behaves
 * normally. No-op with nothing before the table at all (matches the default
 * behavior at the very start of the document).
 */
export function backspaceAtTableStart(s: Schema): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parentOffset !== 0) return false;
    const depth = $from.depth;
    const cell = depth >= 0 ? $from.node(depth) : null;
    if (cell?.type !== s.nodes.table_cell && cell?.type !== s.nodes.table_header) return false;
    if (depth < 2) return false;
    if ($from.index(depth - 1) !== 0 || $from.index(depth - 2) !== 0) return false;

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
 * Backspace or Delete with the *entire* table selected — a `CellSelection`
 * spanning every row and column — deletes the whole table. This is the
 * confirmed convention in both Word and Google Docs: selecting the whole
 * table (its move-handle/four-arrow icon, or dragging across every cell)
 * and pressing Backspace or Delete removes the table outright, while
 * selecting only *some* cells clears just their content — which
 * prosemirror-tables' own default `deleteSelection` handling already does
 * correctly and this leaves untouched. Requires an actual `CellSelection`,
 * not just a bare collapsed caret: a 1×1 table's only cell technically
 * "covers the whole table" by dimension alone, but a single keystroke with
 * nothing selected must never destroy a table (same restraint as
 * {@link backspaceAtTableStart}).
 */
export const deleteWholeTableSelection: Command = (state, dispatch) => {
  if (!(state.selection instanceof CellSelection)) return false;
  const rect = selectedRect(state);
  const wholeTable = rect.left === 0 && rect.top === 0 && rect.right === rect.map.width && rect.bottom === rect.map.height;
  if (!wholeTable) return false;
  return deleteTable(state, dispatch);
};

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
 * to `nextCell` via `TableMap`. At the table's top/bottom edge (no row
 * further in this column), escapes the table the same "reuse a
 * neighbour, else make one" way {@link exitTableAtBoundary} does for
 * Enter — regardless of *which* column, matching Word/Docs/Excel (arrowing
 * up from anywhere in the top row exits above, not just the first cell).
 */
export function tableArrowVertical(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const $cell = cellAround(selection.$head);
    if (!$cell) return false;
    const $next = nextCell($cell, 'vert', dir);
    if ($next) {
      if (dispatch) dispatch(state.tr.setSelection(Selection.near($next, 1)).scrollIntoView());
      return true;
    }
    if (dispatch) {
      const tr = state.tr;
      const boundary = dir === -1 ? $cell.before(-1) : $cell.after(-1);
      const $boundary = tr.doc.resolve(boundary);
      const hasNeighbour = dir === -1 ? $boundary.nodeBefore : $boundary.nodeAfter;
      if (!hasNeighbour) {
        const para = state.schema.nodes.paragraph.createAndFill();
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
 * Tab in the very last cell of a table's last row adds a new row and moves
 * into its first cell, instead of doing nothing (`goToNextCell(1)` returns
 * `false` there — there's no next cell to go to). Matches the near-universal
 * convention across Word, Google Docs and Notion: Tab at a table's last cell
 * keeps you typing by growing the table, the same way Tab at the end of the
 * last row of a spreadsheet does.
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
      // toolbar is never the only way to reach these while writing.
      'Mod-Alt-0': setBlockType(s.nodes.paragraph),
      'Mod-Alt-1': setBlockType(s.nodes.heading, { level: 1 }),
      'Mod-Alt-2': setBlockType(s.nodes.heading, { level: 2 }),
      'Mod-Alt-3': setBlockType(s.nodes.heading, { level: 3 }),
      'Mod-Alt-c': toggleBlockType(s.nodes.code_block, s.nodes.paragraph),
      // 6 slots in next to 7/8/9 (ordered/bullet/quote) for the one other
      // list-shaped block type — checklist.
      'Mod-Shift-6': wrapInList(s.nodes.task_list),
      'Mod-Shift-7': wrapInList(s.nodes.ordered_list),
      'Mod-Shift-8': wrapInList(s.nodes.bullet_list),
      'Mod-Shift-9': wrapIn(s.nodes.blockquote),
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      'Escape': escapeCodeBlock,
      'ArrowUp': tableArrowVertical(-1),
      'ArrowDown': chainCommands(exitCodeBlockDown, tableArrowVertical(1)),
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
      'Backspace': chainCommands(deleteWholeTableSelection, backspaceAtTableStart(s), clearEmptyCodeBlockBackward),
      'Delete': deleteWholeTableSelection,
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
