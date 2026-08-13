import { DOMParser as PMDOMParser, DOMSerializer } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../editor/schema.js';
import { requireDom } from './dom.js';

const REQUIRES_DOM = 'Rich table Markdown export/import requires a browser environment';

/**
 * Serializes a table with any rich (non-simple) cell content as raw HTML —
 * GFM pipe-table syntax has no way to express a cell holding a list,
 * heading, or more than one paragraph (see `classifyTable` in
 * `editor/markdown.ts`, which decides which of the two a given table
 * needs). CommonMark/GFM explicitly permit a raw HTML block in Markdown
 * source (recognized by `markdownCodec`'s tokenizer via `html: true`,
 * restricted to *block*-position HTML — inline text that merely looks like
 * a tag, e.g. `a <b> in a sentence`, is unaffected), so this stays valid,
 * lossless Markdown for a document that has rich table cells — just not
 * pipe-table syntax for this one table. Requires a DOM (browser only, the
 * same constraint `htmlCodec` already has) — the caller decides per table
 * via `classifyTable` first, so plain documents with only simple tables
 * never hit this path.
 */
export function richTableToHtml(table: PMNode): string {
  requireDom(REQUIRES_DOM);
  const dom = DOMSerializer.fromSchema(schema).serializeNode(table, { document });
  const container = document.createElement('div');
  container.appendChild(dom);
  return container.innerHTML;
}

/**
 * Parses a `<table>…</table>` HTML block (as produced by `richTableToHtml`,
 * or written by hand) back into a `table` node, or `null` if the markup
 * doesn't actually contain one — some other, unrelated raw HTML block in
 * the source, which the caller should fall back to preserving as plain
 * text instead of silently dropping.
 */
export function parseHtmlTable(html: string): PMNode | null {
  requireDom(REQUIRES_DOM);
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  if (!dom.body.querySelector('table')) return null;
  const parsed = PMDOMParser.fromSchema(schema).parse(dom.body);
  let table: PMNode | null = null;
  parsed.descendants((node) => {
    if (!table && node.type === schema.nodes.table) table = node;
    return !table;
  });
  return table;
}

/** Turns a table's cells into GFM pipe-table lines (header, separator, body)
 *  given a per-cell text extractor — shared by the lossless round-trip
 *  Codec's no-DOM degrade (`format/markdown.ts`) and the "Copy as Markdown"
 *  simple-table path (`editor/markdown.ts`); the only difference between the
 *  two is how a cell's text is pulled out. */
export function tableToPipeTableLines(table: PMNode, cellText: (cell: PMNode) => string): string[] {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cellText(cell)));
    rows.push(cells);
  });
  const colCount = rows[0]?.length ?? 0;
  return [
    `| ${(rows[0] ?? []).join(' | ')} |`,
    `| ${Array(colCount).fill('---').join(' | ')} |`,
    ...rows.slice(1).map((cells) => `| ${cells.join(' | ')} |`),
  ];
}
