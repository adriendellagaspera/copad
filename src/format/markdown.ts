import {
  MarkdownParser,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownSerializer,
} from 'prosemirror-markdown';
import { Fragment } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, nodeNameOf, type NodeName, type MarkName } from '../editor/schema.js';
import { taskItemChecked } from '../editor/parse.js';
import { writePmDoc, readPmDoc } from './pm.js';
import { classifyTable } from '../editor/markdown.js';
import { richTableToHtml, parseHtmlTable, tableToPipeTableLines } from './tableMarkdown.js';
import { hasDom } from './dom.js';
import type { Codec } from './types.js';
import { extensionOf } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

// CommonMark preset disables GFM strikethrough/tables (enabled below).
// `html: true` enables raw HTML *block* recognition (not html_inline), needed for richTableToHtml's fallback.
const MarkdownItClass = defaultMarkdownParser.tokenizer.constructor as new (
  preset: string,
  options: Record<string, unknown>,
) => typeof defaultMarkdownParser.tokenizer;
const tokenizer = new MarkdownItClass('commonmark', { html: true });
tokenizer.enable(['strikethrough', 'table']);

// Table cells serialize hard_break as `<br>` (no real newlines in a pipe-table row); parsed back here.
tokenizer.inline.ruler.before('html_inline', 'gfmHardBreak', (state, silent) => {
  const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push('hardbreak', 'br', 0);
  state.pos += match[0].length;
  return true;
});

const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  s: { mark: 'strike' satisfies MarkName },
  // thead/tbody are structural wrappers our schema doesn't model (table is table_row+ directly).
  table: { block: 'table' satisfies NodeName },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' satisfies NodeName },
  th: { block: 'table_header' satisfies NodeName },
  td: { block: 'table_cell' satisfies NodeName },
});

// Declarative tokens config can't open a nested paragraph in a cell or splice a prebuilt node.
// `tokenHandlers` is public but untyped, so it's patched here post-construction instead.
type ParserInternals = {
  tokenHandlers: Record<string, (state: MarkdownParseState, tok: { content: string }) => void>;
};
type MarkdownParseState = {
  openNode(type: PMNode['type'], attrs?: Record<string, unknown>): void;
  closeNode(): PMNode | null;
  addText(text: string): void;
  push(node: PMNode): void;
};
const parserInternals = parser as unknown as ParserInternals;

parserInternals.tokenHandlers['td_open'] = (state) => {
  state.openNode(schema.nodes.table_cell);
  state.openNode(schema.nodes.paragraph);
};
parserInternals.tokenHandlers['td_close'] = (state) => {
  state.closeNode();
  state.closeNode();
};
parserInternals.tokenHandlers['th_open'] = (state) => {
  state.openNode(schema.nodes.table_header);
  state.openNode(schema.nodes.paragraph);
};
parserInternals.tokenHandlers['th_close'] = (state) => {
  state.closeNode();
  state.closeNode();
};

// `html: true` also enables html_inline for tag-like text; unmapped tokens throw, so treat as literal text.
// The <br> rule above still runs first, so a real <br> still becomes a hard_break.
parserInternals.tokenHandlers['html_inline'] = (state, tok) => {
  state.addText(tok.content);
};

// html_block round-trips richTableToHtml's <table> fallback; no DOM degrades it to a plain-text paragraph.
parserInternals.tokenHandlers['html_block'] = (state, tok) => {
  if (hasDom()) {
    const table = parseHtmlTable(tok.content);
    if (table) {
      state.push(table);
      return;
    }
  }
  state.openNode(schema.nodes.paragraph);
  state.addText(tok.content.replace(/\n+$/, ''));
  state.closeNode();
};

// `underline` has no CommonMark syntax, so it's dropped silently and doesn't survive a round-trip.
const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    task_list(state, node) {
      state.renderList(node, '  ', (i) => `- [${taskItemChecked(node.child(i)) ? 'x' : ' '}] `);
    },
    task_item(state, node) {
      state.renderContent(node);
    },
    table(state, node) {
      // A cell with a list, heading, or multiple paragraphs has no pipe-table form; falls back to raw HTML.
      const render = classifyTable(node);
      const lines = render.kind === 'simple'
        ? render.lines
        : hasDom()
          ? [richTableToHtml(node)]
          : richTableToPlainTextLines(node);
      lines.forEach((line) => {
        state.write(line);
        state.ensureNewLine();
      });
      state.closeBlock(node);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    underline: { open: '', close: '', mixable: true },
  },
);

// No-DOM fallback for rich cells: flattens to plain text (unlike htmlCodec, this codec isn't browser-only).
function richTableToPlainTextLines(table: PMNode): string[] {
  return tableToPipeTableLines(table, (cell) =>
    cell.textContent.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim());
}

// markdown-it has no checklist token; this is the standard way editors bolt GFM task lists onto it.
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

// Converts only if *every* item has a checkbox prefix; a partial match stays a plain bullet list.
function taskifyBulletList(list: PMNode): PMNode | null {
  const items: PMNode[] = [];
  let allMatch = true;
  list.forEach((item) => {
    const firstChild = item.firstChild;
    if (!firstChild || nodeNameOf(firstChild) !== 'paragraph') {
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

function taskifyLists(node: PMNode): PMNode {
  if (nodeNameOf(node) === 'bullet_list') {
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
