import type { Node } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * Whether `doc` is a single empty textblock — the condition under which the
 * ghost placeholder text below renders. lineBlockHint.ts also checks this: its
 * widget is real inline content, but the placeholder's `::before` is a
 * `float: left; height: 0` trick that doesn't reserve space the way normal
 * content does, so the two visibly collide if both render into that one
 * empty block.
 */
export function isSoleEmptyBlock(doc: Node): boolean {
  return (
    doc.childCount === 1 &&
    !!doc.firstChild &&
    doc.firstChild.isTextblock &&
    doc.firstChild.content.size === 0
  );
}

/** Show ghost placeholder text while the document is a single empty block. */
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
