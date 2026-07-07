import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { undo, redo } from 'y-prosemirror';
import type { MarkType, NodeType, Attrs } from 'prosemirror-model';
import type { EditorState, Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema.js';
import { toggleBlockType } from './plugins.js';

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
  h1: setBlockType(schema.nodes.heading, { level: 1 }),
  h2: setBlockType(schema.nodes.heading, { level: 2 }),
  h3: setBlockType(schema.nodes.heading, { level: 3 }),
  paragraph: setBlockType(schema.nodes.paragraph),
  blockquote: wrapIn(schema.nodes.blockquote),
  bullet: wrapInList(schema.nodes.bullet_list),
  ordered: wrapInList(schema.nodes.ordered_list),
  // A toggle, not a one-way setBlockType: invoking it from inside a code
  // block converts it back to a paragraph — the same command that opens a
  // code block is how you remove one, matching Tiptap's toggleCodeBlock on
  // this exact Mod-Alt-c shortcut. See toggleBlockType in plugins.ts.
  codeBlock: toggleBlockType(schema.nodes.code_block, schema.nodes.paragraph),
  horizontalRule: insertHorizontalRule,
  undo,
  redo,
} as const;
