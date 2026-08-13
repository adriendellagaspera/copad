import { DOMParser as PMDOMParser, DOMSerializer } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../editor/schema.js';
import { requireDom } from './dom.js';

const REQUIRES_DOM = 'Rich table Markdown export/import requires a browser environment';

// GFM pipe cells cannot hold multi-block content; a raw HTML block is still valid Markdown.
export function richTableToHtml(table: PMNode): string {
  requireDom(REQUIRES_DOM);
  const dom = DOMSerializer.fromSchema(schema).serializeNode(table, { document });
  const container = document.createElement('div');
  container.appendChild(dom);
  return container.innerHTML;
}

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
