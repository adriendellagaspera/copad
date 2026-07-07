import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { undo, redo } from 'y-prosemirror';
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

/**
 * The block context the caret sits in right now, as a short human label
 * (`H2`, `Quote`, `Code`, `List`, `Numbered`) — the block-level counterpart to
 * `activeInputMarks`. Walks ancestors innermost-first so the most specific
 * container wins (e.g. a heading inside a list item reports the heading).
 * `null` for a plain paragraph, so the caret hint stays quiet on ordinary text.
 */
export function activeBlockLabel(state: EditorState): string | null {
  if (!state.selection.empty) return null;
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.heading) return `H${node.attrs.level as number}`;
    if (node.type === schema.nodes.code_block) return 'Code';
    if (node.type === schema.nodes.blockquote) return 'Quote';
    if (node.type === schema.nodes.bullet_list) return 'List';
    if (node.type === schema.nodes.ordered_list) return 'Numbered';
  }
  return null;
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
  h3: setBlockType(schema.nodes.heading, { level: 3 }),
  paragraph: setBlockType(schema.nodes.paragraph),
  blockquote: wrapIn(schema.nodes.blockquote),
  bullet: wrapInList(schema.nodes.bullet_list),
  ordered: wrapInList(schema.nodes.ordered_list),
  codeBlock: setBlockType(schema.nodes.code_block),
  horizontalRule: insertHorizontalRule,
  undo,
  redo,
} as const;
