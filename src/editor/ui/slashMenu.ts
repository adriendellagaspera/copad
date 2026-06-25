import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { commands } from '../commands.js';
import { schema } from '../schema.js';

export interface SlashItem {
  title: string;
  hint: string;
  keywords: string;
  command: Command;
}

export const SLASH_ITEMS: SlashItem[] = [
  { title: 'Text', hint: 'Plain paragraph', keywords: 'paragraph text body', command: commands.paragraph },
  { title: 'Heading 1', hint: 'Large section heading', keywords: 'h1 title big', command: commands.h1 },
  { title: 'Heading 2', hint: 'Medium heading', keywords: 'h2 subtitle', command: commands.h2 },
  { title: 'Heading 3', hint: 'Small heading', keywords: 'h3', command: commands.h3 },
  { title: 'Bulleted list', hint: 'Unordered list', keywords: 'bullet unordered ul list', command: commands.bullet },
  { title: 'Numbered list', hint: 'Ordered list', keywords: 'ordered ol numbered list', command: commands.ordered },
  { title: 'Quote', hint: 'Blockquote', keywords: 'quote blockquote', command: commands.blockquote },
  { title: 'Code block', hint: 'Monospace block', keywords: 'code pre fenced', command: commands.codeBlock },
  { title: 'Divider', hint: 'Horizontal rule', keywords: 'divider hr rule line', command: commands.horizontalRule },
];

export function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (it) => it.title.toLowerCase().includes(q) || it.keywords.includes(q)
  );
}

export interface SlashState {
  active: boolean;
  from: number;
  query: string;
  index: number;
  dismissedFrom: number;
}

export const slashKey = new PluginKey<SlashState>('copad-slash');

const INACTIVE: SlashState = { active: false, from: -1, query: '', index: 0, dismissedFrom: -1 };

/** Detect a `/query` trigger at the cursor (block start or after whitespace). */
function derive(state: EditorState): { active: boolean; from: number; query: string } {
  const sel = state.selection;
  if (!sel.empty) return { active: false, from: -1, query: '' };
  const $from = sel.$from;
  if (!$from.parent.isTextblock || $from.parent.type === schema.nodes.code_block) {
    return { active: false, from: -1, query: '' };
  }
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼');
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore);
  if (!match) return { active: false, from: -1, query: '' };
  const slashOffset = match.index + match[0].indexOf('/');
  return { active: true, from: $from.start() + slashOffset, query: match[1] };
}

export function slashMenuPlugin(): Plugin<SlashState> {
  return new Plugin<SlashState>({
    key: slashKey,
    state: {
      init: () => ({ ...INACTIVE }),
      apply(tr, prev, _old, newState) {
        const meta = tr.getMeta(slashKey) as { type: string; index?: number } | undefined;
        const d = derive(newState);
        let dismissedFrom = prev.dismissedFrom;
        let index = 0;

        if (meta?.type === 'dismiss') {
          dismissedFrom = d.from;
        } else if (meta?.type === 'index' && typeof meta.index === 'number') {
          index = meta.index;
        } else if (d.from !== prev.from) {
          dismissedFrom = -1;
          index = 0;
        } else if (d.query !== prev.query) {
          index = 0;
        } else {
          index = prev.index;
        }

        const active = d.active && d.from !== dismissedFrom;
        return { active, from: d.from, query: d.query, index, dismissedFrom };
      },
    },
    props: {
      handleKeyDown(view, event) {
        const st = slashKey.getState(view.state);
        if (!st?.active) return false;
        const items = filterItems(st.query);
        if (event.key === 'Escape') {
          dismissSlash(view);
          return true;
        }
        if (items.length === 0) return false;
        const index = Math.min(st.index, items.length - 1);
        switch (event.key) {
          case 'ArrowDown':
            setSlashIndex(view, (index + 1) % items.length);
            return true;
          case 'ArrowUp':
            setSlashIndex(view, (index - 1 + items.length) % items.length);
            return true;
          case 'Enter':
          case 'Tab':
            runSlashItem(view, items[index]);
            return true;
        }
        return false;
      },
    },
  });
}

export function setSlashIndex(view: EditorView, index: number): void {
  view.dispatch(view.state.tr.setMeta(slashKey, { type: 'index', index }));
}

export function dismissSlash(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(slashKey, { type: 'dismiss' }));
}

/** Delete the `/query` text, then run the chosen block command. */
export function runSlashItem(view: EditorView, item: SlashItem): void {
  const st = slashKey.getState(view.state);
  if (!st?.active) return;
  const to = view.state.selection.from;
  view.dispatch(view.state.tr.delete(st.from, to));
  item.command(view.state, view.dispatch, view);
  view.focus();
}
