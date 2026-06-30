import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * Ghost placeholder shown while the document is a single empty block.
 *
 * When the room has a name (`getTitle()` returns it), that name is shown as a
 * title-style hint — the room's name as the document's H1 placeholder, Notion
 * style — while still distinct from whatever H1 the user actually types. With no
 * name, the generic writing `hint` is shown instead.
 *
 * `getTitle` is read on every decoration pass; the room name lives outside the
 * ProseMirror doc, so the Editor nudges the view when it changes to refresh this.
 */
export function placeholderPlugin(getTitle: () => string | null, hint: string): Plugin {
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
        const title = getTitle();
        return DecorationSet.create(doc, [
          Decoration.node(0, doc.firstChild!.nodeSize, {
            class: title ? 'is-empty is-empty-title' : 'is-empty',
            'data-placeholder': title ?? hint,
          }),
        ]);
      },
    },
  });
}
