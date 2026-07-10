import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { tableNodes } from 'prosemirror-tables';

const listNodes = addListNodes(
  basicSchema.spec.nodes,
  'paragraph block*',
  'block'
);

// Checklist. A dedicated node pair rather than reusing bullet_list/list_item
// with an attr, so a plain bullet list and a checklist stay structurally
// distinct (parseDOM/toDOM, Markdown serialization, and the click-to-toggle
// plugin can each target task_item specifically). priority: 60 (default 50)
// so a checklist's `<ul data-type="taskList">` wins over bullet_list's bare
// `<ul>` rule when parsing HTML — both would otherwise match equally and
// bullet_list, registered first, would win.
//
// Table cells hold real block content — paragraphs, lists, headings,
// quotes, code blocks, dividers — matching Notion/Docs, not the earlier
// GFM-shaped `inline*` (single line, no nesting). Nested tables are the one
// thing still excluded: `tableGroup: 'tableBlock'` (a group of its own,
// distinct from the ordinary `'block'` group `cellContent` draws from) keeps
// `table` out of what a cell can contain, without touching every other node
// spec's own `group: 'block'`. `doc`'s top-level content is widened below to
// admit both groups, since a bare `'block+'` no longer covers tables once
// they've moved to their own group.
const nodes = listNodes
  .append({
    task_list: {
      group: 'block',
      content: 'task_item+',
      parseDOM: [{ tag: 'ul[data-type="taskList"]', priority: 60 }],
      toDOM() {
        return ['ul', { 'data-type': 'taskList' }, 0];
      },
    },
    task_item: {
      content: 'paragraph block*',
      attrs: { checked: { default: false } },
      parseDOM: [
        {
          tag: 'li[data-type="taskItem"]',
          priority: 60,
          getAttrs(dom) {
            return { checked: (dom as HTMLElement).getAttribute('data-checked') === 'true' };
          },
        },
      ],
      toDOM(node) {
        const checked = node.attrs['checked'] === true;
        return [
          'li',
          { 'data-type': 'taskItem', 'data-checked': String(checked) },
          [
            'label',
            { contenteditable: 'false' },
            ['input', { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) }],
          ],
          ['div', { class: 'task-item-content' }, 0],
        ];
      },
    },
  })
  .append(tableNodes({ tableGroup: 'tableBlock', cellContent: 'block+', cellAttributes: {} }))
  .update('doc', { content: '(block | tableBlock)+' });

// `strong`/`em`/`code` (from prosemirror-schema-basic) default to
// `inclusive: true` — typing right after a closed mark (e.g. `**bold**`
// closing, or the toolbar/shortcut toggling a mark off) continues *inside*
// it, since an inclusive mark's boundary still "belongs" to it for typing
// purposes (removeStoredMark only ever suppresses the NEXT insertText call
// through the editor's own API; it can't override how the browser's native
// contenteditable caret sits relative to an inclusive mark's DOM wrapper,
// which is what governs raw typed input). `link` already ships with
// `inclusive: false` — matching CommonMark/Word/Docs/Notion, where closing a
// mark always exits it — so strike/underline (added here) get it too, and
// strong/em/code are overridden to match.
const marks = basicSchema.spec.marks
  .update('strong', { ...basicSchema.spec.marks.get('strong'), inclusive: false })
  .update('em', { ...basicSchema.spec.marks.get('em'), inclusive: false })
  .update('code', { ...basicSchema.spec.marks.get('code'), inclusive: false })
  .addToEnd('strike', {
    inclusive: false,
    parseDOM: [
      { tag: 's' },
      { tag: 'del' },
      { style: 'text-decoration=line-through' },
    ],
    toDOM() {
      return ['s', 0];
    },
  })
  .addToEnd('underline', {
    inclusive: false,
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM() {
      return ['u', 0];
    },
  });

export const schema = new Schema({ nodes, marks });
