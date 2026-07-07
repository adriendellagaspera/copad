import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { undo, redo } from 'y-prosemirror';
import {
  tableNodeTypes,
  isInTable,
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  toggleHeaderRow,
} from 'prosemirror-tables';
import type { MarkType, NodeType, Attrs } from 'prosemirror-model';
import type { EditorState, Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema.js';

/** Insert a horizontal rule at the selection. */
const insertHorizontalRule: Command = (state, dispatch) => {
  if (!schema.nodes.horizontal_rule) return false;
  if (dispatch) {
    dispatch(
      state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView()
    );
  }
  return true;
};

const TABLE_ROWS = 3;
const TABLE_COLS = 3;

/** Insert a default `TABLE_ROWS`×`TABLE_COLS` table (header row + body) at the
 *  selection. A no-op inside an existing table — tables don't nest. */
const insertTable: Command = (state, dispatch) => {
  if (isInTable(state)) return false;
  const types = tableNodeTypes(state.schema);
  if (!types.table || !types.row || !types.cell || !types.header_cell) return false;
  if (dispatch) {
    const headerCells = Array.from({ length: TABLE_COLS }, () => types.header_cell.create());
    const bodyCells = Array.from({ length: TABLE_COLS }, () => types.cell.create());
    const rows = [types.row.create(null, headerCells)];
    for (let i = 1; i < TABLE_ROWS; i += 1) rows.push(types.row.create(null, bodyCells));
    const table = types.table.create(null, rows);
    dispatch(state.tr.replaceSelectionWith(table).scrollIntoView());
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
  return to <= $from.end() && $from.parent.hasMarkup(type, attrs);
}

/** Pre-bound commands used by the Toolbar. */
export const commands = {
  bold: toggleMark(schema.marks.strong),
  italic: toggleMark(schema.marks.em),
  code: toggleMark(schema.marks.code),
  strike: toggleMark(schema.marks.strike),
  underline: toggleMark(schema.marks.underline),
  h1: setBlockType(schema.nodes.heading, { level: 1 }),
  h2: setBlockType(schema.nodes.heading, { level: 2 }),
  h3: setBlockType(schema.nodes.heading, { level: 3 }),
  paragraph: setBlockType(schema.nodes.paragraph),
  blockquote: wrapIn(schema.nodes.blockquote),
  bullet: wrapInList(schema.nodes.bullet_list),
  ordered: wrapInList(schema.nodes.ordered_list),
  taskList: wrapInList(schema.nodes.task_list),
  codeBlock: setBlockType(schema.nodes.code_block),
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

/** Whether the selection sits inside a table — gates the Toolbar's
 *  contextual row/column controls. */
export { isInTable };
