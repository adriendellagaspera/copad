import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { undo, redo } from 'y-prosemirror';
import type { MarkType, NodeType, Attrs } from 'prosemirror-model';
import type { EditorState, Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema.js';

export function runCommand(view: EditorView, cmd: Command): void {
  cmd(view.state, view.dispatch.bind(view));
  view.focus();
}

export function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
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
  h1: setBlockType(schema.nodes.heading, { level: 1 }),
  h2: setBlockType(schema.nodes.heading, { level: 2 }),
  paragraph: setBlockType(schema.nodes.paragraph),
  blockquote: wrapIn(schema.nodes.blockquote),
  bullet: wrapInList(schema.nodes.bullet_list),
  ordered: wrapInList(schema.nodes.ordered_list),
  undo,
  redo,
} as const;
