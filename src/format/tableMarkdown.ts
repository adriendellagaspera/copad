import { DOMParser as PMDOMParser, DOMSerializer } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../editor/schema.js';

function requireDom(): void {
  if (
    typeof window === 'undefined' ||
    typeof window.DOMParser === 'undefined' ||
    typeof document === 'undefined'
  ) {
    throw new Error('Rich table Markdown export/import requires a browser environment');
  }
}

// GFM pipe cells cannot hold multi-block content; a raw HTML block is still valid Markdown.
export function richTableToHtml(table: PMNode): string {
  requireDom();
  const dom = DOMSerializer.fromSchema(schema).serializeNode(table, { document });
  const container = document.createElement('div');
  container.appendChild(dom);
  return container.innerHTML;
}

export function parseHtmlTable(html: string): PMNode | null {
  requireDom();
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
