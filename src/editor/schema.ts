import { Schema } from 'prosemirror-model';
import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { tableNodes } from 'prosemirror-tables';

// `list_item`'s content draws from both the ordinary `'block'` group and the
// separate `'tableBlock'` group (see the comment above `tableGroup` below) —
// otherwise moving `table` out of `'block'` to keep it out of cells would
// also silently drop it from every *other* `block*`/`block+` content
// expression that isn't a cell, including this one.
const listNodes = addListNodes(
  basicSchema.spec.nodes,
  'paragraph (block | tableBlock)*',
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
  // Same widening as `doc` and `list_item`/`task_item` above: `blockquote`
  // drew its content from the plain `'block'` group before `table` moved out
  // of it, so without this it would silently stop admitting a nested table.
  .update('blockquote', {
    ...basicSchema.spec.nodes.get('blockquote'),
    content: '(block | tableBlock)+',
  });

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
