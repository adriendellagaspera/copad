import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** Show ghost placeholder text while the document is a single empty block. */
export function placeholderPlugin(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        const empty =
          doc.childCount === 1 &&
          !!doc.firstChild &&
          doc.firstChild.isTextblock &&
          doc.firstChild.content.size === 0;
        if (!empty) return null;
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
