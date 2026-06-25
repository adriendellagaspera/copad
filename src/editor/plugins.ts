import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from 'prosemirror-inputrules';
import { undo, redo } from 'y-prosemirror';
import type { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

export function buildPlugins(s: Schema): Plugin[] {
  return [
    keymap({
      'Mod-b': toggleMark(s.marks.strong),
      'Mod-i': toggleMark(s.marks.em),
      'Mod-`': toggleMark(s.marks.code),
      // Bridge to the Svelte LinkPopover — handled by a listener on the editor DOM.
      'Mod-k': (_state, _dispatch, view) => {
        view?.dom.dispatchEvent(new CustomEvent('copad:link', { bubbles: true }));
        return true;
      },
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      'Enter': splitListItem(s.nodes.list_item),
      'Tab': sinkListItem(s.nodes.list_item),
      'Shift-Tab': liftListItem(s.nodes.list_item),
    }),
    keymap(baseKeymap),
    inputRules({
      rules: [
        textblockTypeInputRule(/^#\s$/, s.nodes.heading, { level: 1 }),
        textblockTypeInputRule(/^##\s$/, s.nodes.heading, { level: 2 }),
        textblockTypeInputRule(/^###\s$/, s.nodes.heading, { level: 3 }),
        textblockTypeInputRule(/^```$/, s.nodes.code_block),
        wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
        wrappingInputRule(/^\s*([-+*])\s$/, s.nodes.bullet_list),
        wrappingInputRule(/^(\d+)\.\s$/, s.nodes.ordered_list),
        // `---`, `***` or `___` on their own line → horizontal rule.
        new InputRule(/^(?:---|___|\*\*\*)$/, (state, _match, start, end) => {
          return state.tr.replaceRangeWith(start, end, s.nodes.horizontal_rule.create());
        }),
      ],
    }),
  ];
}
