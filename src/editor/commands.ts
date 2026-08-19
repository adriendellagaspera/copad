import { toggleMark, setBlockType } from 'prosemirror-commands';
import { undo, redo } from 'y-prosemirror';
import { tableNodeTypes, isInTable } from 'prosemirror-tables';
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
  deleteTable,
  toggleHeaderRow,
  keepCellTypableAfterHr,
} from './plugins.js';

// keepCellTypableAfterHr (plugins.ts) covers the follow-up fixup a cell needs when the rule lands as its last child.
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

const insertTable: Command = (state, dispatch) => {
  if (isInTable(state)) return false;
  const types = tableNodeTypes(state.schema);
  if (!types.table || !types.row || !types.cell || !types.header_cell) return false;
  if (dispatch) {
    // createAndFill, not create: cell content is block+ (schema.ts); create() would yield a childless cell.
    const headerCells = Array.from({ length: TABLE_COLS }, () => types.header_cell.createAndFill()!);
    const bodyCells = Array.from({ length: TABLE_COLS }, () => types.cell.createAndFill()!);
    const rows = [types.row.create(null, headerCells)];
    for (let i = 1; i < TABLE_ROWS; i += 1) rows.push(types.row.create(null, bodyCells));
    const table = types.table.create(null, rows);
    const { tr } = state;
    const from = tr.selection.from;
    tr.replaceSelectionWith(table);
    // replaceSelectionWith can leave the selection in the last cell; re-anchor to the first header cell explicitly.
    let tablePos = -1;
    tr.doc.nodesBetween(Math.max(0, from - 1), tr.doc.content.size, (node, pos) => {
      if (tablePos === -1 && node.type === types.table) tablePos = pos;
    });
    if (tablePos !== -1) {
      const paragraphType = state.schema.nodes.paragraph;
      if (paragraphType) {
        const tableSize = tr.doc.nodeAt(tablePos)!.nodeSize;
        // A table at the doc's first/last position traps the caret (no neighbour to escape into) — add one.
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

export function activeInputMarks(state: EditorState): MarkType[] {
  const { empty, $from } = state.selection;
  if (!empty) return [];
  return (state.storedMarks ?? $from.marks()).map((mark) => mark.type);
}

export type BlockContext = { label: string; pos: number };

// Walks ancestors innermost-first (heading in a list item reports the heading); pos anchors to the current line.
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
  // Walk ancestors: a list/blockquote wraps content, so $from.parent (the inner paragraph) never matches it directly.
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).hasMarkup(type, attrs)) return true;
  }
  return false;
}

export const commands = {
  bold: toggleMark(schema.marks.strong),
  italic: toggleMark(schema.marks.em),
  code: toggleMark(schema.marks.code),
  strike: toggleMark(schema.marks.strike),
  underline: toggleMark(schema.marks.underline),
  h1: toggleHeading(schema.nodes.heading, schema.nodes.paragraph, 1),
  h2: toggleHeading(schema.nodes.heading, schema.nodes.paragraph, 2),
  h3: toggleHeading(schema.nodes.heading, schema.nodes.paragraph, 3),
  paragraph: setBlockType(schema.nodes.paragraph),
  blockquote: toggleWrap(schema.nodes.blockquote),
  bullet: toggleList(schema.nodes.bullet_list, schema.nodes.list_item),
  ordered: toggleList(schema.nodes.ordered_list, schema.nodes.list_item),
  taskList: toggleList(schema.nodes.task_list, schema.nodes.task_item),
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
