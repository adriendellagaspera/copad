import { Schema } from 'prosemirror-model';
import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { tableNodes } from 'prosemirror-tables';

// `table` lives in its own `tableBlock` group (keeping it out of cells), so every
// non-cell content expression must name both groups to still admit tables.
const listNodes = addListNodes(
  basicSchema.spec.nodes,
  'paragraph (block | tableBlock)*',
  'block'
);

// priority: 60 (default 50) so `<ul data-type="taskList">` beats bullet_list's bare `<ul>` rule.
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
      content: 'paragraph (block | tableBlock)*',
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
  .update('doc', { content: '(block | tableBlock)+' })
  .update('blockquote', {
    ...basicSchema.spec.nodes.get('blockquote'),
    content: '(block | tableBlock)+',
  });

// Every mark is `inclusive: false`: with the schema-basic default of true, typing
// right after a closed mark continues inside it, and removeStoredMark cannot
// override where the native contenteditable caret sits in the mark's DOM wrapper.
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

/** Every node name this schema produces. The single source of truth other
 *  modules compare against — never a bare string — so a typo in a
 *  `nodeNameOf(node) === '…'` check is a compile error (TS2367/TS2678), not a
 *  silent runtime false. */
export type NodeName =
  | 'doc'
  | 'paragraph'
  | 'blockquote'
  | 'horizontal_rule'
  | 'heading'
  | 'code_block'
  | 'text'
  | 'image'
  | 'hard_break'
  | 'ordered_list'
  | 'bullet_list'
  | 'list_item'
  | 'task_list'
  | 'task_item'
  | 'table'
  | 'table_row'
  | 'table_cell'
  | 'table_header';

/** Every mark name this schema produces — see {@link NodeName}. */
export type MarkName = 'link' | 'em' | 'strong' | 'code' | 'strike' | 'underline';

export const schema = new Schema<NodeName, MarkName>({ nodes, marks });

/** The one place a ProseMirror node's runtime `string` name is cast to the
 *  schema's closed `NodeName` union — the IO boundary crossing from
 *  prosemirror-model into typed code. Every other module compares against
 *  this, never `node.type.name` directly. */
export function nodeNameOf(node: PMNode): NodeName {
  return node.type.name as NodeName;
}

/** Mark equivalent of {@link nodeNameOf}. */
export function markNameOf(mark: Mark): MarkName {
  return mark.type.name as MarkName;
}
