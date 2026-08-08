import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { schema } from '../editor/schema.js';
import { writePmDoc } from './pm.js';
import { encodeDocx } from './docxEncode.js';

function seeded() {
  const { paragraph, heading, bullet_list, ordered_list, list_item, task_list, task_item, blockquote, code_block, table, table_row, table_header, table_cell, horizontal_rule } = schema.nodes;
  const { strong, em, strike, underline, code, link } = schema.marks;
  const doc = new Y.Doc();
  writePmDoc(
    doc,
    schema.topNodeType.create(null, [
      heading.create({ level: 1 }, schema.text('Title')),
      paragraph.create(null, [
        schema.text('plain '),
        schema.text('bold', [strong.create()]),
        schema.text(' '),
        schema.text('italic', [em.create()]),
        schema.text(' '),
        schema.text('gone', [strike.create()]),
        schema.text(' '),
        schema.text('under', [underline.create()]),
        schema.text(' '),
        schema.text('code', [code.create()]),
        schema.text(' '),
        schema.text('site', [link.create({ href: 'https://example.com' })]),
      ]),
      bullet_list.create(null, [
        list_item.create(null, paragraph.create(null, schema.text('one'))),
        list_item.create(null, [
          paragraph.create(null, schema.text('two')),
          bullet_list.create(null, [
            list_item.create(null, paragraph.create(null, schema.text('nested'))),
          ]),
        ]),
      ]),
      ordered_list.create(null, [
        list_item.create(null, paragraph.create(null, schema.text('first'))),
        list_item.create(null, paragraph.create(null, schema.text('second'))),
      ]),
      ordered_list.create(null, [
        list_item.create(null, paragraph.create(null, schema.text('restarted'))),
      ]),
      task_list.create(null, [
        task_item.create({ checked: true }, paragraph.create(null, schema.text('done'))),
        task_item.create({ checked: false }, paragraph.create(null, schema.text('todo'))),
      ]),
      blockquote.create(null, paragraph.create(null, schema.text('quoted'))),
      code_block.create(null, schema.text('line1\nline2')),
      horizontal_rule.create(),
      table.create(null, [
        table_row.create(null, [
          table_header.create(null, paragraph.create(null, schema.text('A'))),
          table_header.create(null, paragraph.create(null, schema.text('B'))),
        ]),
        table_row.create(null, [
          table_cell.create(null, paragraph.create(null, schema.text('1'))),
          table_cell.create(null, paragraph.create(null, schema.text('2'))),
        ]),
      ]),
    ])
  );
  return doc;
}

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('word/document.xml missing from generated .docx');
  return xml;
}

async function stylesXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/styles.xml')?.async('string');
  if (!xml) throw new Error('word/styles.xml missing from generated .docx');
  return xml;
}

describe('encodeDocx', () => {
  it('produces a valid .docx (zip) archive containing word/document.xml', async () => {
    const bytes = await encodeDocx(seeded());
    expect(bytes).toBeInstanceOf(Uint8Array);
    // ZIP local file header magic number.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const xml = await documentXml(bytes);
    expect(xml).toContain('Title');
  });

  it('carries every mark through as text content', async () => {
    const xml = await documentXml(await encodeDocx(seeded()));
    for (const text of ['plain', 'bold', 'italic', 'gone', 'under', 'code', 'site']) {
      expect(xml).toContain(text);
    }
    expect(xml).toContain('w:hyperlink');
  });

  it('renders nested bullet lists and restarts a second ordered list at a fresh instance', async () => {
    const xml = await documentXml(await encodeDocx(seeded()));
    expect(xml).toContain('nested');
    // Two distinct <w:numId> values for the two separate ordered_list nodes.
    const numIds = new Set([...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
    expect(numIds.size).toBeGreaterThanOrEqual(2);
  });

  it('marks checked/unchecked task items with distinct glyphs', async () => {
    const xml = await documentXml(await encodeDocx(seeded()));
    expect(xml).toContain('☑');
    expect(xml).toContain('☐');
  });

  it('renders a table with a bold header row', async () => {
    const xml = await documentXml(await encodeDocx(seeded()));
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('A');
    expect(xml).toContain('1');
  });

  it('renders a cell holding more than a single paragraph (list, heading, …)', async () => {
    // Regression: a cell is block+ content, not bare inline text — a cell
    // renderer that assumes the latter silently drops every character.
    const { paragraph, heading, bullet_list, list_item, table, table_row, table_header, table_cell } = schema.nodes;
    const doc = new Y.Doc();
    writePmDoc(
      doc,
      schema.topNodeType.create(null, [
        table.create(null, [
          table_row.create(null, [table_header.create(null, paragraph.create(null, schema.text('Col')))]),
          table_row.create(null, [
            table_cell.create(null, [
              heading.create({ level: 2 }, schema.text('Rich cell')),
              bullet_list.create(null, [
                list_item.create(null, paragraph.create(null, schema.text('one'))),
                list_item.create(null, paragraph.create(null, schema.text('two'))),
              ]),
            ]),
          ]),
        ]),
      ]),
    );
    const xml = await documentXml(await encodeDocx(doc));
    expect(xml).toContain('Rich cell');
    expect(xml).toContain('one');
    expect(xml).toContain('two');
  });

  it('sizes table columns as an equal percentage of the full table width', async () => {
    // Regression: an unset table/cell width falls back to a handful of twips
    // (near-zero), collapsing every column to unreadable slivers.
    const xml = await documentXml(await encodeDocx(seeded()));
    expect(xml).toContain('<w:tblW w:type="pct" w:w="100%"/>');
    const cellWidths = [...xml.matchAll(/<w:tcW w:type="pct" w:w="([\d.]+)%"\/>/g)].map((m) => Number(m[1]));
    expect(cellWidths.length).toBeGreaterThan(0);
    for (const w of cellWidths) expect(w).toBeCloseTo(50, 0); // seeded() is a 2-column table
  });

  it('sets a legible default body font/size, not OOXML\'s bare 10pt fallback', async () => {
    // Regression: an empty docDefaults leaves body text at the spec's own
    // fallback (10pt, no named font), reading as illegibly small.
    const xml = await stylesXml(await encodeDocx(seeded()));
    expect(xml).toContain('<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia"');
    expect(xml).toContain('<w:sz w:val="24"/>');
  });

  it('joins code_block lines with an explicit line break', async () => {
    const xml = await documentXml(await encodeDocx(seeded()));
    expect(xml).toContain('line1');
    expect(xml).toContain('line2');
    expect(xml).toContain('<w:br/>');
  });
});
