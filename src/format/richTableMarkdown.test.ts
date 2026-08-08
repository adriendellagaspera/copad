// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import { markdownCodec } from './markdown.js';
import { classifyTable, docToMarkdown } from '../editor/markdown.js';
import { richTableToHtml, parseHtmlTable } from './tableMarkdown.js';

const { table, table_row, table_cell, paragraph, bullet_list, list_item, heading } = schema.nodes;

function simpleCell(text: string) {
  return table_cell.create(null, [paragraph.create(null, schema.text(text))]);
}

function richCell(...blocks: ReturnType<typeof paragraph.create>[]) {
  return table_cell.create(null, blocks);
}

describe('classifyTable', () => {
  it('is simple, with pipe-table lines, for a table whose every cell is a single plain paragraph', () => {
    const t = table.create(null, [table_row.create(null, [simpleCell('A'), simpleCell('B')])]);
    const render = classifyTable(t);
    expect(render.kind).toBe('simple');
    expect(render.kind === 'simple' && render.lines.join('\n')).toContain('| A | B |');
  });

  it('is rich when any cell has more than one paragraph', () => {
    const cell = richCell(paragraph.create(null, schema.text('one')), paragraph.create(null, schema.text('two')));
    const t = table.create(null, [table_row.create(null, [cell, simpleCell('B')])]);
    expect(classifyTable(t).kind).toBe('rich');
  });

  it('is rich when any cell holds a list', () => {
    const item = list_item.create(null, [paragraph.create(null, schema.text('x'))]);
    const cell = richCell(bullet_list.create(null, [item]));
    const t = table.create(null, [table_row.create(null, [cell])]);
    expect(classifyTable(t).kind).toBe('rich');
  });
});

describe('richTableToHtml / parseHtmlTable round-trip', () => {
  it('serializes a rich table (list in a cell) to an HTML <table> string', () => {
    const item = list_item.create(null, [paragraph.create(null, schema.text('one'))]);
    const cell = richCell(bullet_list.create(null, [item]));
    const t = table.create(null, [table_row.create(null, [cell, simpleCell('plain')])]);
    const html = richTableToHtml(t);
    expect(html).toContain('<table>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
    expect(html).toContain('one');
  });

  it('parses that HTML back into an equivalent table node', () => {
    const item = list_item.create(null, [paragraph.create(null, schema.text('one'))]);
    const cell = richCell(bullet_list.create(null, [item]));
    const t = table.create(null, [table_row.create(null, [cell, simpleCell('plain')])]);
    const html = richTableToHtml(t);
    const parsed = parseHtmlTable(html);
    expect(parsed?.type.name).toBe('table');
    const firstCell = parsed?.firstChild?.firstChild;
    expect(firstCell?.firstChild?.type.name).toBe('bullet_list');
    expect(parsed?.textContent).toContain('one');
    expect(parsed?.textContent).toContain('plain');
  });

  it('returns null for an html block that is not actually a table', () => {
    expect(parseHtmlTable('<div>just a div</div>')).toBeNull();
  });
});

describe('markdownCodec round-trip with rich table cells', () => {
  it('exports a rich table as an embedded HTML block, not broken pipe-table syntax', async () => {
    const heading1 = heading.create({ level: 2 }, schema.text('Heading in a cell'));
    const cell = richCell(heading1);
    const doc = new Y.Doc();
    writePmDoc(doc, schema.topNodeType.create(null, [table.create(null, [table_row.create(null, [cell, simpleCell('plain')])])]));
    const bytes = await markdownCodec.encode(doc);
    const md = new TextDecoder().decode(bytes);
    expect(md).toContain('<table>');
    expect(md).toContain('<h2>Heading in a cell</h2>');
    // Never emits the broken pipe-table shape for this table (a heading has
    // no pipe-table equivalent, and must not silently truncate/flatten it).
    expect(md).not.toContain('| Heading in a cell |');
  });

  it('imports that same embedded HTML table back into a real table node', async () => {
    const heading1 = heading.create({ level: 2 }, schema.text('Heading in a cell'));
    const cell = richCell(heading1);
    const src = new Y.Doc();
    writePmDoc(src, schema.topNodeType.create(null, [table.create(null, [table_row.create(null, [cell, simpleCell('plain')])])]));
    const bytes = await markdownCodec.encode(src);

    const dst = new Y.Doc();
    await markdownCodec.decode(bytes, dst);
    const restored = readPmDoc(dst);
    expect(restored.firstChild?.type.name).toBe('table');
    const restoredCell = restored.firstChild?.firstChild?.firstChild;
    expect(restoredCell?.firstChild?.type.name).toBe('heading');
    expect(restoredCell?.textContent).toBe('Heading in a cell');
  });

  it('a simple table (no rich cells) still round-trips as plain GFM pipe-table syntax, unchanged', async () => {
    const doc = new Y.Doc();
    writePmDoc(doc, schema.topNodeType.create(null, [table.create(null, [
      table_row.create(null, [simpleCell('A'), simpleCell('B')]),
      table_row.create(null, [simpleCell('1'), simpleCell('2')]),
    ])]));
    const bytes = await markdownCodec.encode(doc);
    const md = new TextDecoder().decode(bytes);
    expect(md).toContain('| A | B |');
    expect(md).not.toContain('<table>');
  });

  it('a raw HTML block unrelated to a table (hand-written by a user) is preserved as literal text, not dropped', async () => {
    const dst = new Y.Doc();
    await markdownCodec.decode(new TextEncoder().encode('before\n\n<div>hello</div>\n\nafter\n'), dst);
    const restored = readPmDoc(dst);
    expect(restored.textContent).toContain('before');
    expect(restored.textContent).toContain('<div>hello</div>');
    expect(restored.textContent).toContain('after');
  });
});

describe('docToMarkdown (Copy as Markdown) with rich table cells', () => {
  it('embeds a rich table as HTML rather than emitting broken/empty pipe-table cells', () => {
    const item = list_item.create(null, [paragraph.create(null, schema.text('x'))]);
    const cell = richCell(bullet_list.create(null, [item]));
    const doc = schema.topNodeType.create(null, [table.create(null, [table_row.create(null, [cell, simpleCell('y')])])]);
    const out = docToMarkdown(doc);
    expect(out).toContain('<table>');
    expect(out).toContain('<ul>');
  });
});
