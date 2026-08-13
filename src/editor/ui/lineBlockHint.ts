import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { activeBlockContext } from '../commands.js';
import { isSoleEmptyBlock } from './placeholder.js';

type LineBlockHintState = { focused: boolean };

const key = new PluginKey<LineBlockHintState>('lineBlockHint');

function widgetFor(label: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'line-hint-inline';
  el.textContent = label;
  el.contentEditable = 'false';
  // The block's own tag already conveys this to assistive tech.
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// A widget decoration, not a floating badge: the text column reserves no margin
// (editor.css), so only real inline content has somewhere to sit without overlapping.
export function lineBlockHintPlugin(): Plugin {
  return new Plugin({
    key,
    state: {
      init: () => ({ focused: false }),
      apply(tr, value) {
        const meta = tr.getMeta(key) as LineBlockHintState | undefined;
        return meta ?? value;
      },
    },
    view(view) {
      const onFocus = () => view.dispatch(view.state.tr.setMeta(key, { focused: true }));
      const onBlur = () => view.dispatch(view.state.tr.setMeta(key, { focused: false }));
      view.dom.addEventListener('focus', onFocus);
      view.dom.addEventListener('blur', onBlur);
      return {
        destroy() {
          view.dom.removeEventListener('focus', onFocus);
          view.dom.removeEventListener('blur', onBlur);
        },
      };
    },
    props: {
      decorations(state: EditorState) {
        if (!key.getState(state)?.focused) return null;
        // The placeholder's `::before` float reserves no line space, so it would
        // visibly collide with this widget in that one empty block.
        if (isSoleEmptyBlock(state.doc)) return null;
        const ctx = activeBlockContext(state);
        if (!ctx) return null;
        return DecorationSet.create(state.doc, [
          // Key includes the label: ProseMirror reuses a widget's DOM across redraws
          // whenever the key matches, so a stale label would linger.
          Decoration.widget(ctx.pos, () => widgetFor(ctx.label), {
            side: -1,
            key: `line-hint:${ctx.pos}:${ctx.label}`,
            ignoreSelection: true,
          }),
        ]);
      },
    },
  });
}
