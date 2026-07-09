// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import { htmlCodec } from './html.js';

function seeded() {
  const { paragraph, heading } = schema.nodes;
  const { strong } = schema.marks;
  const doc = new Y.Doc();
  writePmDoc(
    doc,
    schema.topNodeType.create(null, [
      heading.create({ level: 2 }, schema.text('Heading')),
      paragraph.create(null, [schema.text('a '), schema.text('b', [strong.create()])]),
    ]),
  );
  return doc;
}

describe('html codec', () => {
  it('serialises to HTML tags', async () => {
    const html = new TextDecoder().decode(await htmlCodec.encode(seeded()));
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>');
  });

  it('round-trips structure and marks through HTML', async () => {
    const bytes = await htmlCodec.encode(seeded());
    const dst = new Y.Doc();
    await htmlCodec.decode(bytes, dst);
    const restored = readPmDoc(dst);
    expect(restored.textContent).toContain('Heading');
    expect(JSON.stringify(restored.toJSON())).toContain('"strong"');
  });

  it('round-trips underline through <u>', async () => {
    const { paragraph } = schema.nodes;
    const { underline } = schema.marks;
    const doc = new Y.Doc();
    writePmDoc(
      doc,
      schema.topNodeType.create(null, [
        paragraph.create(null, schema.text('under', [underline.create()])),
      ]),
    );
    const bytes = await htmlCodec.encode(doc);
    expect(new TextDecoder().decode(bytes)).toContain('<u>');
    const dst = new Y.Doc();
    await htmlCodec.decode(bytes, dst);
    const restored = readPmDoc(dst);
    expect(JSON.stringify(restored.toJSON())).toContain('"underline"');
  });

  it('round-trips a checklist through data-type="taskList"/"taskItem"', async () => {
    const { paragraph, task_list, task_item } = schema.nodes;
    const doc = new Y.Doc();
    writePmDoc(
      doc,
      schema.topNodeType.create(null, [
        task_list.create(null, [
          task_item.create({ checked: true }, paragraph.create(null, schema.text('done'))),
        ]),
      ]),
    );
    const bytes = await htmlCodec.encode(doc);
    const html = new TextDecoder().decode(bytes);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    const dst = new Y.Doc();
    await htmlCodec.decode(bytes, dst);
    const restored = readPmDoc(dst);
    expect(restored.firstChild?.type.name).toBe('task_list');
    expect(restored.firstChild?.firstChild?.attrs.checked).toBe(true);
  });

  it('round-trips a table through <table>/<th>/<td>', async () => {
    const { table, table_row, table_cell, table_header } = schema.nodes;
    const doc = new Y.Doc();
    writePmDoc(
      doc,
      schema.topNodeType.create(null, [
        table.create(null, [
          table_row.create(null, [table_header.create(null, schema.text('A'))]),
          table_row.create(null, [table_cell.create(null, schema.text('1'))]),
        ]),
      ]),
    );
    const bytes = await htmlCodec.encode(doc);
    const html = new TextDecoder().decode(bytes);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('<td>');
    const dst = new Y.Doc();
    await htmlCodec.decode(bytes, dst);
    const restored = readPmDoc(dst);
    expect(restored.firstChild?.type.name).toBe('table');
    expect(restored.firstChild?.firstChild?.firstChild?.type.name).toBe('table_header');
  });
});
