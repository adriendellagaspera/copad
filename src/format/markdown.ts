import {
  MarkdownParser,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownSerializer,
} from 'prosemirror-markdown';
import { Fragment } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../editor/schema.js';
import { taskItemChecked } from '../editor/parse.js';
import { writePmDoc, readPmDoc } from './pm.js';
import type { Codec } from './types.js';
import { extensionOf } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

// Reuse the markdown-it engine behind the default parser, but turn GFM
// strikethrough back on (the CommonMark preset ships it disabled) and map its
// `s` token to our `strike` mark — so `~~…~~` survives a full round-trip.
const MarkdownItClass = defaultMarkdownParser.tokenizer.constructor as new (
  preset: string,
  options: Record<string, unknown>,
) => typeof defaultMarkdownParser.tokenizer;
const tokenizer = new MarkdownItClass('commonmark', { html: false });
tokenizer.enable(['strikethrough']);

const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  s: { mark: 'strike' },
});

// The default serializer covers our basic+list nodes and em/strong/code/link;
// teach it our `strike` mark to match the parser above, drop `underline`
// silently (Markdown has no native underline syntax — same as CommonMark
// itself: the mark just doesn't survive a round-trip through this format),
// and add a checklist node serializer (GFM `- [ ] `/`- [x] `).
const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    task_list(state, node) {
      state.renderList(node, '  ', (i) => `- [${taskItemChecked(node.child(i)) ? 'x' : ' '}] `);
    },
    task_item(state, node) {
      state.renderContent(node);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    underline: { open: '', close: '', mixable: true },
  },
);

/** A bare `[ ] `/`[x] `/`[X] ` at the start of a list item's first paragraph —
 *  GFM's checklist syntax once the leading `- ` has already become a
 *  bullet_list/list_item pair (markdown-it has no dedicated checklist token;
 *  this is the standard way editors bolt GFM task lists onto a plain parser). */
const CHECKBOX_PREFIX = /^\[([ xX])\]\s/;

function stripCheckboxPrefix(paragraph: PMNode): { checked: boolean; rest: PMNode } | null {
  const first = paragraph.firstChild;
  if (!first || !first.isText || !first.text) return null;
  const match = CHECKBOX_PREFIX.exec(first.text);
  if (!match) return null;
  const checked = /x/i.test(match[1]);
  const tailText = first.text.slice(match[0].length);
  const rest: PMNode[] = [];
  if (tailText) rest.push(schema.text(tailText, first.marks));
  paragraph.forEach((child, _offset, i) => {
    if (i > 0) rest.push(child);
  });
  return { checked, rest: schema.nodes.paragraph.create(paragraph.attrs, rest) };
}

/** Convert a bullet_list into a task_list when *every* item starts with a
 *  checkbox prefix — a partially-checkbox list has no equivalent in our
 *  schema (task_list's content is task_item+ only) and is left as a plain
 *  bullet list with the literal `[ ] ` text, same as any other Markdown
 *  construct our schema can't represent. */
function taskifyBulletList(list: PMNode): PMNode | null {
  const items: PMNode[] = [];
  let allMatch = true;
  list.forEach((item) => {
    const firstChild = item.firstChild;
    if (!firstChild || firstChild.type.name !== 'paragraph') {
      allMatch = false;
      return;
    }
    const stripped = stripCheckboxPrefix(firstChild);
    if (!stripped) {
      allMatch = false;
      return;
    }
    const restChildren: PMNode[] = [];
    item.forEach((child, _offset, i) => {
      if (i > 0) restChildren.push(taskifyLists(child));
    });
    items.push(schema.nodes.task_item.create({ checked: stripped.checked }, [stripped.rest, ...restChildren]));
  });
  if (!allMatch || items.length === 0) return null;
  return schema.nodes.task_list.create(null, items);
}

/** Recursively convert every checkbox-shaped bullet_list in a parsed document
 *  into a task_list. */
function taskifyLists(node: PMNode): PMNode {
  if (node.type.name === 'bullet_list') {
    const converted = taskifyBulletList(node);
    if (converted) return converted;
  }
  if (node.isText || node.childCount === 0) return node;
  const children: PMNode[] = [];
  let changed = false;
  node.forEach((child) => {
    const next = taskifyLists(child);
    if (next !== child) changed = true;
    children.push(next);
  });
  return changed ? node.copy(Fragment.fromArray(children)) : node;
}

/**
 * Markdown (CommonMark + GFM strikethrough and checklists). Maps cleanly onto
 * our schema for the structures Markdown can express (headings, lists,
 * blockquotes, code, emphasis, strikethrough, checklists…). Constructs our
 * schema doesn't model (underline, mixed checkbox/plain lists…) are dropped
 * or flattened on import/export.
 */
export const markdownCodec: Codec = {
  id: 'markdown',
  label: 'Markdown',
  extensions: ['.md', '.markdown'].map(extensionOf),

  decode(bytes, doc) {
    const parsed = parser.parse(decoder.decode(bytes));
    if (!parsed) throw new Error('Markdown: could not parse document');
    writePmDoc(doc, taskifyLists(parsed));
  },

  encode(doc) {
    return encoder.encode(serializer.serialize(readPmDoc(doc)));
  },
};
