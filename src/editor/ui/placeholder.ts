import type { Node } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Excludes code blocks: the placeholder copy invites "/" commands, which slashMenu.ts
// disables there, and it would make an empty code block look like a plain paragraph.
export function isSoleEmptyBlock(doc: Node): boolean {
  return (
    doc.childCount === 1 &&
    !!doc.firstChild &&
    doc.firstChild.isTextblock &&
    !doc.firstChild.type.spec.code &&
    doc.firstChild.content.size === 0
  );
}

export function placeholderPlugin(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        if (!isSoleEmptyBlock(doc)) return null;
        return DecorationSet.create(doc, [
          Decoration.node(0, doc.firstChild!.nodeSize, {
            class: 'is-empty',
            'data-placeholder': text,
          }),
        ]);
      },
    },
  });
}
