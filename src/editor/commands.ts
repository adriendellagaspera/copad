import { toggleMark, setBlockType } from 'prosemirror-commands';
import { undo, redo } from 'y-prosemirror';
import { tableNodeTypes, isInTable, deleteTable } from 'prosemirror-tables';
import type { MarkType, NodeType, Attrs } from 'prosemirror-model';
import { TextSelection, type EditorState, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema.js';
import {
  toggleBlockType,
  toggleHeading,
  toggleList,
  toggleWrap,
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  toggleHeaderRow,
  keepCellTypableAfterHr,
} from './plugins.js';

/** Insert a horizontal rule at the selection — including inside a table
 *  cell, which now holds real block content (see schema.ts): confirmed
 *  `replaceSelectionWith` splits the enclosing paragraph and inserts the
 *  rule as a sibling within the cell, leaving the table's own structure
 *  untouched, exactly as it already does for a plain paragraph outside any
 *  table. This is the command reached from the slash menu and the toolbar
 *  divider button — `insertTable`'s own no-nested-table guard is unrelated
 *  and stays. `keepCellTypableAfterHr` covers the one follow-up fixup a
 *  cell needs when the rule lands as its last child (see plugins.ts). */
const insertHorizontalRule: Command = (state, dispatch) => {
  if (!schema.nodes.horizontal_rule) return false;
  if (dispatch) {
    const { from } = state.selection;
    const tr = state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create());
    keepCellTypableAfterHr(tr, schema, tr.mapping.map(from));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

const TABLE_ROWS = 3;
const TABLE_COLS = 3;

/** Insert a 3×3 table (1 header row + 2 body rows) at the selection. A no-op
 *  inside an existing table — nesting tables isn't supported. */
const insertTable: Command = (state, dispatch) => {
  if (isInTable(state)) return false;
  const types = tableNodeTypes(state.schema);
  if (!types.table || !types.row || !types.cell || !types.header_cell) return false;
  if (dispatch) {
    // createAndFill (not create) — cells now hold real block content
    // (`block+`, see schema.ts), so an empty cell needs a default child (an
    // empty paragraph) to stay schema-valid; a bare `.create()` would (since
    // it skips content validation) silently produce a structurally invalid,
    // childless cell with no textblock to land a selection in at all.
    const headerCells = Array.from({ length: TABLE_COLS }, () => types.header_cell.createAndFill()!);
    const bodyCells = Array.from({ length: TABLE_COLS }, () => types.cell.createAndFill()!);
    const rows = [types.row.create(null, headerCells)];
    for (let i = 1; i < TABLE_ROWS; i += 1) rows.push(types.row.create(null, bodyCells));
    const table = types.table.create(null, rows);
    const { tr } = state;
    const from = tr.selection.from;
    tr.replaceSelectionWith(table);
    // `replaceSelectionWith` may split the surrounding paragraph to fit the
    // table in as a sibling block, so its own post-insert selection can land
    // in the *last* cell rather than the first — parking a fresh table's
    // caret in the last cell instead of the first is surprising (every other
    // editor starts you typing the first header) and, worse, leaves Tab with
    // nowhere to go (it tabs out of the editor entirely). Re-anchor to the
    // first header cell's content explicitly.
    let tablePos = -1;
    tr.doc.nodesBetween(Math.max(0, from - 1), tr.doc.content.size, (node, pos) => {
      if (tablePos === -1 && node.type === types.table) tablePos = pos;
    });
    if (tablePos !== -1) {
      const paragraphType = state.schema.nodes.paragraph;
      if (paragraphType) {
        const tableSize = tr.doc.nodeAt(tablePos)!.nodeSize;
        // A table landing as the doc's very first or very last node leaves
        // no neighbouring block for ArrowUp/ArrowDown to escape into (see
        // tableArrowVertical's "nothing to escape into" branch, which then
        // swallows the key rather than doing something worse) — exactly
        // what replaceSelectionWith produces when the table replaces a
        // doc's sole (empty) paragraph, trapping the caret inside the table
        // with no way out. Guarantee an escape hatch on whichever side is
        // missing, same as a doc is never allowed to start/end mid-table.
        if (tablePos === 0) {
          tr.insert(0, paragraphType.create());
          tablePos += paragraphType.create().nodeSize;
        }
        if (tablePos + tableSize === tr.doc.content.size) {
          tr.insert(tablePos + tableSize, paragraphType.create());
        }
      }
      // +1 into the table, +1 into the first row, +1 into the first cell.
      tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 3)));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export function runCommand(view: EditorView, cmd: Command): void {
  cmd(view.state, view.dispatch.bind(view));
  view.focus();
}

export function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/**
 * The inline marks that would apply to text typed at the caret *right now* —
 * the explicit stored marks after a `Mod-B`/`Mod-I` toggle, else the marks
 * inherited from the caret position. Empty for a non-collapsed selection (the
 * selection toolbar already reflects those). This is what tells the writer
 * "you're armed to type in bold" before any character is typed.
 */
export function activeInputMarks(state: EditorState): MarkType[] {
  const { empty, $from } = state.selection;
  if (!empty) return [];
  return (state.storedMarks ?? $from.marks()).map((mark) => mark.type);
}

/** A named block context (`H2`, `Quote`, …) anchored to where its line starts. */
export type BlockContext = { label: string; pos: number };

/**
 * The block context the caret's line sits in right now — the block-level
 * counterpart to `activeInputMarks`. Walks ancestors innermost-first so the
 * most specific container wins (e.g. a heading inside a list item reports
 * the heading), but `pos` always anchors to the start of the immediate
 * textblock (the current line), not the matched ancestor — so a label for a
 * quoted paragraph still floats at that paragraph's own line rather than the
 * quote's first line. `null` for a plain paragraph — or a list item, whose
 * bullet/number already makes its own nature visible without a label — so a
 * line hint reading it stays quiet on ordinary text. Uses `$from` only — a
 * caret's line context doesn't depend on whether the selection is empty.
 */
export function activeBlockContext(state: EditorState): BlockContext | null {
  const { $from } = state.selection;
  const pos = $from.start($from.depth);
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.heading) return { label: `H${node.attrs.level as number}`, pos };
    if (node.type === schema.nodes.code_block) return { label: 'Code', pos };
    if (node.type === schema.nodes.blockquote) return { label: 'Quote', pos };
  }
  return null;
}

/** Just the label from {@link activeBlockContext} — convenient where the anchor position isn't needed. */
export function activeBlockLabel(state: EditorState): string | null {
  return activeBlockContext(state)?.label ?? null;
}

export function isNodeActive(
  state: EditorState,
  type: NodeType,
  attrs?: Attrs
): boolean {
  const { $from, to } = state.selection;
  if (to > $from.end($from.depth)) return false;
  // Walk ancestors, not just the immediate textblock: a list or blockquote
  // is a *wrapping* node, so `$from.parent` (the inner paragraph) never
  // matches it — without this, the bullet/ordered/checklist/quote toolbar
  // buttons could never light up as active.
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).hasMarkup(type, attrs)) return true;
  }
  return false;
}

/** Pre-bound commands used by the Toolbar. */
export const commands = {
  bold: toggleMark(schema.marks.strong),
  italic: toggleMark(schema.marks.em),
  code: toggleMark(schema.marks.code),
  strike: toggleMark(schema.marks.strike),
  underline: toggleMark(schema.marks.underline),
  // Toggles (see plugins.ts): re-invoking the active one reverts to a plain
  // paragraph, so every block button doubles as its own "off" and there's
  // always a path back to body text.
  h1: toggleHeading(schema.nodes.heading, schema.nodes.paragraph, 1),
  h2: toggleHeading(schema.nodes.heading, schema.nodes.paragraph, 2),
  h3: toggleHeading(schema.nodes.heading, schema.nodes.paragraph, 3),
  paragraph: setBlockType(schema.nodes.paragraph),
  blockquote: toggleWrap(schema.nodes.blockquote),
  bullet: toggleList(schema.nodes.bullet_list, schema.nodes.list_item),
  ordered: toggleList(schema.nodes.ordered_list, schema.nodes.list_item),
  taskList: toggleList(schema.nodes.task_list, schema.nodes.task_item),
  // A toggle, not a one-way setBlockType: invoking it from inside a code
  // block converts it back to a paragraph — the same command that opens a
  // code block is how you remove one, matching Tiptap's toggleCodeBlock on
  // this exact Mod-Alt-c shortcut. See toggleBlockType in plugins.ts.
  codeBlock: toggleBlockType(schema.nodes.code_block, schema.nodes.paragraph),
  horizontalRule: insertHorizontalRule,
  insertTable,
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  toggleHeaderRow,
  undo,
  redo,
} as const;

export { isInTable };
