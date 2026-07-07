import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { activeBlockContext } from '../commands.js';

type LineBlockHintState = { focused: boolean };

const key = new PluginKey<LineBlockHintState>('lineBlockHint');

function widgetFor(label: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'line-hint-inline';
  el.textContent = label;
  el.contentEditable = 'false';
  // The block's own tag (h1/h2/h3, etc.) already conveys this to assistive
  // tech; the label is a sighted-only convenience, not new information.
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/**
 * Names the block the caret's line is in (H1/H2/H3, quote, code) as a real
 * inline element at the start of that line — not a floating overlay. This
 * app's text column has almost no reserved margin (`.app` caps at 960px,
 * `--measure` is sized to fill the card, see editor.css), so a left-margin
 * badge has nowhere to live, and floating one above the line risks
 * overlapping whatever came before it (inter-block margins range from 0 —
 * blockquote — to ~2em — h1). A widget decoration sidesteps both: it
 * participates in real layout, pushing the line's own text over, so there's
 * no overlap to solve.
 */
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
        // Desktop-only convenience (gated for real via the `.line-hint-inline`
        // CSS's `pointer: fine` media query) — but skip it entirely while
        // unfocused so it doesn't appear over a document nobody is editing.
        if (!key.getState(state)?.focused) return null;
        const ctx = activeBlockContext(state);
        if (!ctx) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(ctx.pos, () => widgetFor(ctx.label), {
            side: -1,
            key: 'line-hint',
            ignoreSelection: true,
          }),
        ]);
      },
    },
  });
}
