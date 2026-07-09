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
// GFM-shaped tables: cells hold inline content only (single line, no
// multi-paragraph), matching what Markdown tables can actually express —
// `cellContent: 'inline*'` rather than the library default of `block+`.
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
  .append(tableNodes({ tableGroup: 'block', cellContent: 'inline*', cellAttributes: {} }));

const marks = basicSchema.spec.marks
  .addToEnd('strike', {
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
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM() {
      return ['u', 0];
    },
  });

export const schema = new Schema({ nodes, marks });
