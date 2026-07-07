import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { tableNodes } from 'prosemirror-tables';
import { taskItemChecked } from './parse.js';

const listNodes = addListNodes(
  basicSchema.spec.nodes,
  'paragraph block*',
  'block'
);

// Task list nodes mirror list_item's shape (content "paragraph block*", so a
// checklist item can hold a nested list/checklist) but carry a `checked` attr
// and their own DOM markup — a `<label><input type=checkbox></label>` the
// click-toggle plugin in plugins.ts listens on (no NodeView: a plain toDOM is
// enough since we never need the input's own checked state to be authoritative).
const nodes = listNodes
  .append({
    task_list: {
      group: 'block',
      content: 'task_item+',
      // Higher than the default 50: bullet_list's own `{tag: 'ul'}` rule
      // (from prosemirror-schema-list) would otherwise win on a plain tag
      // match, since it has no attribute to disqualify it here.
      parseDOM: [{ tag: 'ul[data-type="taskList"]', priority: 60 }],
      toDOM() {
        return ['ul', { 'data-type': 'taskList' }, 0];
      },
    },
    task_item: {
      content: 'paragraph block*',
      defining: true,
      attrs: { checked: { default: false } },
      parseDOM: [
        {
          tag: 'li[data-type="taskItem"]',
          priority: 60,
          getAttrs: (dom) => ({ checked: dom.getAttribute('data-checked') === 'true' }),
        },
      ],
      toDOM(node) {
        const checked = taskItemChecked(node);
        return [
          'li',
          { 'data-type': 'taskItem', 'data-checked': String(checked) },
          ['label', { contenteditable: 'false' }, ['input', checked ? { type: 'checkbox', checked: 'checked' } : { type: 'checkbox' }]],
          ['div', { class: 'task-item-content' }, 0],
        ];
      },
    },
  })
  // GFM-shaped tables: cells hold inline content only (`cellContent:
  // 'inline*'`), matching GFM's single-line-per-cell semantics and — as a
  // side effect — matching what markdown-it's table tokens hand the Markdown
  // codec (a bare inline token per cell, no wrapping paragraph).
  .append(
    tableNodes({
      tableGroup: 'block',
      cellContent: 'inline*',
      cellAttributes: {},
    })
  );

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
    parseDOM: [
      { tag: 'u' },
      { style: 'text-decoration=underline' },
    ],
    toDOM() {
      return ['u', 0];
    },
  });

export const schema = new Schema({ nodes, marks });
