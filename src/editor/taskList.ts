import { Plugin } from 'prosemirror-state';
import { schema } from './schema.js';
import { taskItemChecked } from './parse.js';

/**
 * Toggle a task_item's `checked` attr when its checkbox is clicked. There's no
 * NodeView here — the checkbox is a plain `toDOM` element (see schema.ts) —
 * so this plugin is the only thing that ever writes `checked`; the browser's
 * own native toggle is purely cosmetic until the dispatched transaction
 * re-renders the node from the (now updated) attrs.
 */
export const taskItemCheckboxPlugin = new Plugin({
  props: {
    handleClick(view, pos, event) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.nodeName !== 'INPUT') return false;
      if ((target as HTMLInputElement).type !== 'checkbox') return false;
      const $pos = view.state.doc.resolve(pos);
      for (let depth = $pos.depth; depth >= 0; depth -= 1) {
        const node = $pos.node(depth);
        if (node.type === schema.nodes.task_item) {
          const itemPos = $pos.before(depth);
          view.dispatch(
            view.state.tr.setNodeMarkup(itemPos, undefined, { checked: !taskItemChecked(node) })
          );
          return true;
        }
      }
      return false;
    },
  },
});
