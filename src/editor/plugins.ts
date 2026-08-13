import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, toggleMark, setBlockType, wrapIn, lift, selectTextblockStart, selectTextblockEnd } from 'prosemirror-commands';
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
  deleteTable as deleteTableRaw,
  CellSelection,
  cellAround,
  nextCell,
  TableMap,
} from 'prosemirror-tables';
import { Fragment, Slice } from 'prosemirror-model';
import type { Attrs, MarkType, Node as PMNode, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { Selection, TextSelection, PluginKey, Plugin } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { normalizeHref, isValidHref } from './linkCommands.js';
import { taskItemCheckboxPlugin } from './taskList.js';

// Never mutates the code block itself (it may be deliberately blank) — matches Tiptap's exitCode, which only deletes/converts via Backspace or Mod-Alt-c.
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

function inCodeBlock(state: EditorState): ResolvedPos | null {
  const { $head, $anchor } = state.selection;
  if (!$head.sameParent($anchor) || !$head.parent.type.spec.code) return null;
  return $head;
}

// Always returns true: Firefox blurs contenteditable on Escape by default, so it must be swallowed even with no code block to exit.
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

// Fires only where native ArrowDown has nowhere left to move the caret (end of a code block's content); returns false everywhere else.
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

// Only a third Enter after two trailing blank lines exits (matches Tiptap's exitOnTripleEnter) — a single blank line is common in real code and must not trigger it.
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

// Matches Tiptap's CodeBlock Backspace handler, but narrower: doesn't also fire on a non-empty block at doc start, unlike Tiptap's.
export const clearEmptyCodeBlockBackward: Command = (state, dispatch) => {
  const $pos = inCodeBlock(state);
  if (!$pos || $pos.parent.content.size !== 0 || $pos.parentOffset !== 0) return false;
  if (dispatch) {
    dispatch(state.tr.setNodeMarkup($pos.before(), state.schema.nodes.paragraph));
  }
  return true;
};

export function toggleBlockType(type: NodeType, paragraph: NodeType): Command {
  const setType = setBlockType(type);
  const setParagraph = setBlockType(paragraph);
  return (state, dispatch, view) => {
    const { $from, to } = state.selection;
    const active = to <= $from.end() && $from.parent.hasMarkup(type);
    return (active ? setParagraph : setType)(state, dispatch, view);
  };
}

function ancestorHasType(state: EditorState, type: NodeType, attrs?: Attrs | null): boolean {
  const { $from, to } = state.selection;
  if (to > $from.end($from.depth)) return false;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).hasMarkup(type, attrs ?? null)) return true;
  }
  return false;
}

export function toggleHeading(headingType: NodeType, paragraphType: NodeType, level: number): Command {
  return (state, dispatch, view) => {
    const active = ancestorHasType(state, headingType, { level });
    return (active ? setBlockType(paragraphType) : setBlockType(headingType, { level }))(state, dispatch, view);
  };
}

export function toggleList(listType: NodeType, itemType: NodeType): Command {
  const wrap = wrapInList(listType);
  const off = liftListItem(itemType);
  return (state, dispatch, view) =>
    (ancestorHasType(state, listType) ? off : wrap)(state, dispatch, view);
}

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

// Paired regexp must anchor at `$` with two groups: 1 the whole delimited run, 2 the inner text; delimiters assumed symmetric.
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
    // Without an explicit caret here, the mapped selection biases past the insertion into the next table cell.
    tr.setSelection(TextSelection.create(tr.doc, textEnd));
    tr.removeStoredMark(markType);
    return tr;
  };
}

/** Bold: `**text**` or `__text__`. */
export const BOLD_STAR_RULE = /(?:^|\s)(\*\*(?!\s)([^*]+)\*\*)$/;
export const BOLD_UNDERSCORE_RULE = /(?:^|\s)(__(?!\s)([^_]+)__)$/;
// Declared after the bold rules so a closing `**` is never read as a dangling `*`.
export const ITALIC_STAR_RULE = /(?:^|\s)(\*(?!\s)([^*]+)\*)$/;
export const ITALIC_UNDERSCORE_RULE = /(?:^|\s)(_(?!\s)([^_]+)_)$/;
export const STRIKE_RULE = /(?:^|\s)(~~(?!\s)([^~]+)~~)$/;
export const CODE_RULE = /(?:^|\s)(`(?!\s)([^`]+)`)$/;
export const LINK_RULE = /(?:^|\s)(\[([^\]]+)\]\(([^)\s]+)\))$/;
// Deliberately not `- [ ] ` (GFM syntax, handled on markdown import): the bullet-list rule already fires on `- ` alone and would pre-empt a dash-prefixed trigger.
export const CHECKLIST_RULE = /^\s*\[([ xX]?)\]\s$/;
export const HORIZONTAL_RULE_RULE = /^(?:---|___|\*\*\*)$/;

// `findWrapping` has no notion of "already inside a task_item", so a bare wrappingInputRule no-ops past the first checklist row; this flips `checked` instead of re-wrapping when already inside one.
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

// Confirmed live: an hr landing as a cell's last child leaves its NodeSelection at the cell's outer edge, and further typing jumps to the next cell instead of inserting locally. Appending an empty paragraph gives back a normal in-cell typing position.
export function keepCellTypableAfterHr(tr: Transaction, s: Schema, mappedPos: number): void {
  const $pos = tr.doc.resolve(mappedPos);
  const $cell = cellAround($pos);
  const cellNode = $cell?.nodeAfter;
  if (!$cell || !cellNode || cellNode.lastChild?.type !== s.nodes.horizontal_rule) return;
  const para = s.nodes.paragraph.createAndFill();
  if (!para) return;
  const insertAt = $cell.pos + 1 + cellNode.content.size;
  tr.insert(insertAt, para);
  tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 1), 1));
}

// See keepCellTypableAfterHr for the follow-up fixup an in-cell hr needs.
export function horizontalRuleHandler(s: Schema): RuleHandler {
  return (state, _match, start, end) => {
    const tr = state.tr.replaceRangeWith(start, end, s.nodes.horizontal_rule.create());
    keepCellTypableAfterHr(tr, s, tr.mapping.map(start));
    return tr;
  };
}

// Returns false in a code block, where Shift-Enter falls through to native newline-in-<pre>, same as plain Enter via newlineInCode.
export const insertHardBreak: Command = (state, dispatch) => {
  const br = state.schema.nodes.hard_break;
  if (!br || state.selection.$from.parent.type.spec.code) return false;
  if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
  return true;
};

// Final fallback in the Tab keymap chain: without it, Tab falls through to the browser's tab-out-of-the-editor default, a keyboard trap out of the document.
export const insertTabCharacter: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.insertText('\t').scrollIntoView());
  return true;
};

// Always swallows the key too, for the same reason insertTabCharacter does — in reverse.
export const removeTabCharacterBefore: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (empty && $from.parentOffset > 0 && $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset) === '\t') {
    if (dispatch) dispatch(state.tr.delete($from.pos - 1, $from.pos).scrollIntoView());
  }
  return true;
};

// A table's `isolating` boundary blocks baseKeymap's joinBackward at the top-left cell, so Backspace there otherwise does nothing: delete an empty preceding block outright, else park the caret at its end.
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

// Mirror of backspaceAtTableStart for the bottom-right cell: joinForward is blocked by the table's isolating boundary the same way joinBackward is.
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

// Schema content rules can only ban a table as a cell's *direct* child, not nested deeper inside one, so a pasted slice can still carry it through — strip it here instead. Slice-local, never touches a synced transaction.
export function stripNestedTables(slice: Slice, s: Schema): Slice {
  function strip(fragment: Fragment, insideCell: boolean): Fragment {
    let changed = false;
    const kept: PMNode[] = [];
    fragment.forEach((node) => {
      if (insideCell && node.type === s.nodes.table) {
        changed = true;
        return;
      }
      const isCell = node.type === s.nodes.table_cell || node.type === s.nodes.table_header;
      const content = strip(node.content, insideCell || isCell);
      if (content === node.content) {
        kept.push(node);
      } else {
        changed = true;
        kept.push(node.copy(content));
      }
    });
    return changed ? Fragment.fromArray(kept) : fragment;
  }
  const content = strip(slice.content, false);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

// "Goal column" for a table escape/re-entry: an empty escape paragraph's caret has no x-position to read a target column back out of, so it's remembered here instead. Cleared on any selection change not coming through tableArrowVertical/tableArrowFromOutside.
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

// Shared column math for entering an adjacent table: Selection.near has no notion of "same column" and would otherwise always land in the first cell, dropping the goal column.
function adjacentTableCellPos(table: PMNode, boundary: number, dir: 1 | -1, col: number): number {
  const map = TableMap.get(table);
  const tableStart = (dir === -1 ? boundary - table.nodeSize : boundary) + 1;
  const targetRow = dir === -1 ? map.height - 1 : 0;
  const clampedCol = Math.min(col, map.width - 1);
  return tableStart + map.positionAt(targetRow, clampedCol, table);
}

// The raw arithmetic cell boundary is one depth level too shallow for an empty child textblock (a fresh table's cells) — a caret can never rest there, so the naive comparison silently never matched (confirmed live: trapped the caret). Snapping each boundary through TextSelection.near fixes it.
function cellContentRange($cell: ResolvedPos): { start: number; end: number } {
  const node = $cell.nodeAfter;
  const rawStart = $cell.pos + 1;
  const rawEnd = rawStart + (node ? node.content.size : 0);
  const doc = $cell.doc;
  const start = TextSelection.near(doc.resolve(rawStart), 1).from;
  const end = TextSelection.near(doc.resolve(rawEnd), -1).from;
  return { start, end };
}

// Escapes only at the cell's true content edge (cellContentRange), not just a wrapped-paragraph edge — deliberately structural rather than chasing the visual last line the way prosemirror-tables' own unexported atEndOfCell does via view.endOfTextblock (a minor imprecision on a wrapped paragraph's bottom line, not a correctness bug). Never creates a block to escape into.
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
    // Swallow rather than fall through: prosemirror-tables' own vertical-arrow handler (tableEditing()) would otherwise mimic horizontal movement here.
    if (!hasNeighbour) return true;
    if (dispatch) {
      const tr = state.tr;
      // Same column-aware entry as tableArrowFromOutside — a bare Selection.near always lands in the first cell, dropping the goal column.
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

// Only the true outer corners of the whole cell are broken: with no further native caret position, the browser has been observed (confirmed live) to either wrap to the first cell or escape the ProseMirror view onto page chrome, swallowing the next keystroke.
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

// Counterpart to tableArrowVertical's escape branch: without it, entry is left to the browser's native fallback, which consistently lands in the table's last cell regardless of caret position.
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

// prosemirror-tables' own shiftArrow is gated behind the same atEndOfCell check broken for our flatter cells (see tableArrowVertical), so it never fires; nextCell via TableMap sidesteps it. A bare caret gates on cellContentRange's edge, same as the plain Arrow commands, so mid-cell Shift-Arrow still extends a native text selection.
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
      const { start, end } = cellContentRange($cell);
      if (dir === -1 ? sel.$head.pos !== start : sel.$head.pos !== end) return false;
      anchorCell = $cell;
      headCell = $cell;
    }
    const $next = nextCell(headCell, axis, dir);
    if (!$next) return false;
    if (dispatch) dispatch(state.tr.setSelection(new CellSelection(anchorCell, $next)));
    return true;
  };
}

// Yjs's UndoManager (yUndoPlugin, Editor.svelte) coalesces consecutive changes within ~500ms, right for typing but wrong for a discrete structural edit; stopCapturing() resets that window first so mashing "add row" five times undoes one row at a time.
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
export const deleteTable = freshUndoStep(deleteTableRaw);

// Matches Google Docs: Tab at the last cell grows the table instead of no-op. Only fires when the current last row isn't entirely empty, to avoid piling up empty rows on a stray repeated Tab (a known Docs/Word irritant) — deliberate deviation from strict Docs parity. Still swallows the key when declining, since falling through would tab focus out of the editor.
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
      // Mod-` is macOS-reserved for cycling app windows; no browser sees the keystroke, so it's bound on Mod-Shift-c instead.
      'Mod-Shift-c': toggleMark(s.marks.code),
      'Mod-Shift-x': toggleMark(s.marks.strike),
      // Mod-U alone is Chrome/Firefox's reserved View Source shortcut and can't be preventDefault-ed.
      'Mod-Shift-u': toggleMark(s.marks.underline),
      // Bridge to the Svelte LinkPopover — handled by a listener on the editor DOM.
      // Shifted because Mod-K is the command palette, app-wide and unconditional.
      'Mod-Shift-k': (_state, _dispatch, view) => {
        view?.dom.dispatchEvent(new CustomEvent('copad:link', { bubbles: true }));
        return true;
      },
      'Mod-Alt-0': setBlockType(s.nodes.paragraph),
      'Mod-Alt-1': toggleHeading(s.nodes.heading, s.nodes.paragraph, 1),
      'Mod-Alt-2': toggleHeading(s.nodes.heading, s.nodes.paragraph, 2),
      'Mod-Alt-3': toggleHeading(s.nodes.heading, s.nodes.paragraph, 3),
      'Mod-Alt-c': toggleBlockType(s.nodes.code_block, s.nodes.paragraph),
      'Mod-Shift-6': toggleList(s.nodes.task_list, s.nodes.task_item),
      'Mod-Shift-7': toggleList(s.nodes.ordered_list, s.nodes.list_item),
      'Mod-Shift-8': toggleList(s.nodes.bullet_list, s.nodes.list_item),
      'Mod-Shift-9': toggleWrap(s.nodes.blockquote),
      'Mod-z': undo,
      'Mod-y': redo,
      // Known accepted gap: on an AZERTY Mac, prosemirror-keymap's keyCode fallback resolves physical US-W to 'w' not 'z', so this doesn't fire there; Mod-y still reaches redo on every layout.
      'Mod-Shift-z': redo,
      'Escape': escapeCodeBlock,
      // Bound explicitly so the selection lands synchronously in `state`: a fast Home/End then Arrow would otherwise read a stale selection via the async selectionchange event.
      'Home': selectTextblockStart,
      'End': selectTextblockEnd,
      'ArrowUp': chainCommands(tableArrowVertical(-1), tableArrowFromOutside(-1)),
      'ArrowDown': chainCommands(exitCodeBlockDown, tableArrowVertical(1), tableArrowFromOutside(1)),
      'ArrowLeft': tableArrowHorizontal(-1),
      'ArrowRight': tableArrowHorizontal(1),
      'Shift-ArrowUp': tableShiftArrow('vert', -1),
      'Shift-ArrowDown': tableShiftArrow('vert', 1),
      'Shift-ArrowLeft': tableShiftArrow('horiz', -1),
      'Shift-ArrowRight': tableShiftArrow('horiz', 1),
      // Explicit `checked: false` for the new item: splitListItem otherwise copies the original item's attrs onto both halves, pre-ticking the new row.
      'Enter': chainCommands(
        exitCodeBlockOnBlankLine,
        splitListItem(s.nodes.list_item),
        splitListItem(s.nodes.task_item, { checked: false })
      ),
      'Shift-Enter': insertHardBreak,
      // A CellSelection here falls through to baseKeymap's deleteSelection, which clears content but keeps table structure (Word/Docs/Notion convention) — deleting rows/columns is the separate Alt-Shift-Backspace family below.
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
      // Written as `Alt-Shift-<lowercase>`, not `Alt-<UPPERCASE>` — NOT interchangeable: on macOS, Option+Shift+letter can compose into an accented/special character in event.key (confirmed live), which `Alt-R` has nothing left to match; prosemirror-keymap's own keyCode fallback for this only ever reconstructs the `Shift-Alt-<lowercase>` shape (verified against its keydownHandler). No shortcut for deleting the whole table — that stays behind the toolbar panel's trash button.
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
