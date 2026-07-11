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
import { isTableSimple, simpleTableToMarkdownLines } from '../editor/markdown.js';
import { richTableToHtml, parseHtmlTable } from './tableMarkdown.js';
import type { Codec } from './types.js';
import { extensionOf } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const hasDom = (): boolean =>
  typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined' && typeof document !== 'undefined';

// Reuse the markdown-it engine behind the default parser, but turn on the GFM
// extras the CommonMark preset ships disabled: strikethrough (`~~…~~`, mapped
// to our `strike` mark below) and tables (`table`, a built-in markdown-it rule
// gated by preset — see rules_block/table.mjs). `html: true` recognizes raw
// HTML *blocks* (a line starting with a known block-level tag, per CommonMark
// — never inline text that merely contains `<`/`>`, a separate markdown-it
// rule `html_inline` this leaves off) — needed for `richTableToHtml`'s
// fallback below, since GFM pipe-table syntax can't express a cell holding a
// list, heading, or more than one paragraph. See the `html_block` handler
// further down for what happens to a parsed block.
const MarkdownItClass = defaultMarkdownParser.tokenizer.constructor as new (
  preset: string,
  options: Record<string, unknown>,
) => typeof defaultMarkdownParser.tokenizer;
const tokenizer = new MarkdownItClass('commonmark', { html: true });
tokenizer.enable(['strikethrough', 'table']);

// GFM tables serialize a cell's hard_break as literal `<br>` (see `cellText`
// below), since a real newline can't appear inside a single-line pipe-table
// row. Teach the tokenizer to parse it back the same way, reusing the
// 'hardbreak' token markdown-it's own newline rule already emits elsewhere —
// already mapped to `hard_break` below, so no parser config change is needed
// beyond this rule. Independent of the `html` option (left off): this
// recognizes only this one specific tag, not arbitrary HTML.
tokenizer.inline.ruler.before('html_inline', 'gfmHardBreak', (state, silent) => {
  const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push('hardbreak', 'br', 0);
  state.pos += match[0].length;
  return true;
});

const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  s: { mark: 'strike' },
  // GFM tables. `thead`/`tbody` are pure structural wrappers our schema
  // doesn't model (a `table` node is directly `table_row+`); `th`/`td` map
  // onto cells — the actual inline content gets wrapped in a paragraph by
  // the td_open/th_open/td_close/th_close handlers patched in below, since
  // `cellContent` is `block+` now (see schema.ts), not the bare inline
  // content markdown-it hands back for a GFM pipe-table cell.
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' },
});

// MarkdownParser's public `tokens` config only supports the declarative
// {block}/{node}/{mark}/{ignore} shapes (see tokenHandlers in
// prosemirror-markdown's source) — none of which can open a *nested*
// paragraph inside a cell, or splice an already-built node (the rich-table
// case below) into the tree. `tokenHandlers` itself is a plain, public (if
// undocumented/untyped) property MarkdownParser reads fresh on every
// `.parse()` call, so patching it after construction is the supported
// extension point once the declarative shapes run out — not a private/
// internal hack, just one without its own TS types to import.
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
  state.closeNode(); // paragraph
  state.closeNode(); // table_cell
};
parserInternals.tokenHandlers['th_open'] = (state) => {
  state.openNode(schema.nodes.table_header);
  state.openNode(schema.nodes.paragraph);
};
parserInternals.tokenHandlers['th_close'] = (state) => {
  state.closeNode(); // paragraph
  state.closeNode(); // table_header
};

// `html: true` above (needed for the rich-table fallback below) also turns
// on `html_inline` recognition for any inline text that merely looks like a
// tag (e.g. "a <b> in a sentence") — MarkdownParser has no default handler
// for it and throws on an unmapped token type, so it needs one explicitly:
// treated as literal text, the same experience `html: false` gave before
// (the raw characters, not specially escaped or interpreted). The `<br>`
// rule above still runs *before* html_inline in the ruler chain, so a real
// `<br>` continues to become a hard_break, never reaching this handler.
parserInternals.tokenHandlers['html_inline'] = (state, tok) => {
  state.addText(tok.content);
};

// `html_block` — a raw HTML block at block position (see `html: true`
// above) — is how `richTableToHtml`'s fallback round-trips: if the block's
// content actually contains a `<table>`, parse it back into a real `table`
// node (requires a DOM; falls through to the plain-text branch below in a
// non-browser context, e.g. these codec tests run under plain Node — an
// honest degrade, not a silent data loss, since the raw markup stays
// visible as text). Anything else (some unrelated raw HTML the user typed,
// or a table block encountered with no DOM available) is preserved as a
// plain paragraph of literal text rather than dropped.
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

// The default serializer covers our basic+list nodes and em/strong/code/link;
// teach it our `strike` mark to match the parser above, drop `underline`
// silently (Markdown has no native underline syntax — same as CommonMark
// itself: the mark just doesn't survive a round-trip through this format),
// and add checklist + GFM table node serializers.
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
      // A table with rich (multi-block) cell content — a list, heading, or
      // more than one paragraph in some cell — has no GFM pipe-table
      // equivalent; fall back to an embedded raw HTML block (valid,
      // lossless Markdown — see `richTableToHtml`'s doc comment). Every
      // *simple* table (every cell just a single paragraph — true for
      // every table before cells held real block content, and still the
      // overwhelmingly common case) keeps the unchanged pipe-table output.
      const lines = isTableSimple(node)
        ? simpleTableToMarkdownLines(node)
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

/** No-DOM degrade for a rich (multi-block) table cell when `richTableToHtml`
 *  (DOM-only, see its doc comment) isn't available: flatten each cell's
 *  block structure to plain inline text into a GFM pipe-table row. Lossy
 *  (lists/headings/multiple paragraphs collapse to one line of text) but an
 *  honest degrade — same philosophy as the `html_block` decode handler's own
 *  no-DOM fallback above — rather than `markdownCodec.encode()` throwing
 *  outside a browser (this codec, unlike `htmlCodec`, isn't documented as
 *  browser-only). */
function richTableToPlainTextLines(table: PMNode): string[] {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(cell.textContent.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim());
    });
    rows.push(cells);
  });
  const colCount = rows[0]?.length ?? 0;
  return [
    `| ${(rows[0] ?? []).join(' | ')} |`,
    `| ${Array(colCount).fill('---').join(' | ')} |`,
    ...rows.slice(1).map((cells) => `| ${cells.join(' | ')} |`),
  ];
}

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
 * Markdown (CommonMark + GFM strikethrough, tables and checklists). Maps
 * cleanly onto our schema for the structures Markdown can express (headings,
 * lists, blockquotes, code, emphasis, strikethrough, tables, checklists…).
 * Constructs our schema doesn't model (underline, mixed checkbox/plain
 * lists…) are dropped or flattened on import/export.
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
