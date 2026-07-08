import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import { yjsCodec } from './yjs.js';
import { textCodec } from './text.js';
import { jsonCodec } from './json.js';
import { markdownCodec } from './markdown.js';
import { codecForFilename, knownExtensions, DEFAULT_CODEC } from './index.js';
import type { Codec } from './types.js';

// A representative document exercising headings, marks, lists.
function sampleDoc() {
  const { paragraph, heading, bullet_list, list_item } = schema.nodes;
  const { strong, em, strike } = schema.marks;
  return schema.topNodeType.create(null, [
    heading.create({ level: 1 }, schema.text('Title')),
    paragraph.create(null, [
      schema.text('plain '),
      schema.text('bold', [strong.create()]),
      schema.text(' '),
      schema.text('italic', [em.create()]),
      schema.text(' '),
      schema.text('gone', [strike.create()]),
    ]),
    bullet_list.create(null, [
      list_item.create(null, paragraph.create(null, schema.text('one'))),
      list_item.create(null, paragraph.create(null, schema.text('two'))),
    ]),
  ]);
}

function seeded() {
  const doc = new Y.Doc();
  writePmDoc(doc, sampleDoc());
  return doc;
}

async function roundTrip(codec: Codec): Promise<ReturnType<typeof readPmDoc>> {
  const src = seeded();
  const bytes = await codec.encode(src);
  expect(bytes).toBeInstanceOf(Uint8Array);
  const dst = new Y.Doc();
  await codec.decode(bytes, dst);
  return readPmDoc(dst);
}

describe('yjs codec', () => {
  it('round-trips the document losslessly (full CRDT state)', async () => {
    const restored = await roundTrip(yjsCodec);
    expect(restored.toJSON()).toEqual(sampleDoc().toJSON());
  });
});

describe('json codec', () => {
  it('round-trips the document structure losslessly', async () => {
    const restored = await roundTrip(jsonCodec);
    expect(restored.toJSON()).toEqual(sampleDoc().toJSON());
  });

  it('produces valid, human-readable JSON', async () => {
    const bytes = await jsonCodec.encode(seeded());
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    expect(parsed.type).toBe('doc');
  });
});

describe('markdown codec', () => {
  it('preserves headings, emphasis, strike and lists', async () => {
    const restored = await roundTrip(markdownCodec);
    const json = JSON.stringify(restored.toJSON());
    expect(restored.textContent).toContain('Title');
    // strong/em/strike marks survive the round-trip
    expect(json).toContain('"strong"');
    expect(json).toContain('"em"');
    expect(json).toContain('"strike"');
    expect(json).toContain('bullet_list');
  });

  it('serialises strike as ~~…~~', async () => {
    const md = new TextDecoder().decode(await markdownCodec.encode(seeded()));
    expect(md).toContain('# Title');
    expect(md).toContain('~~gone~~');
  });

  it('flattens underline to plain text (Markdown has no underline syntax)', async () => {
    const { paragraph } = schema.nodes;
    const { underline } = schema.marks;
    const doc = new Y.Doc();
    writePmDoc(
      doc,
      schema.topNodeType.create(null, [
        paragraph.create(null, schema.text('under', [underline.create()])),
      ])
    );
    const md = new TextDecoder().decode(await markdownCodec.encode(doc));
    expect(md).toContain('under');
    expect(md).not.toMatch(/<\/?u>/);
  });

  it('keeps the link syntax when the linked text is also underlined', async () => {
    const { paragraph } = schema.nodes;
    const { underline, link } = schema.marks;
    const doc = new Y.Doc();
    writePmDoc(
      doc,
      schema.topNodeType.create(null, [
        paragraph.create(null, [
          schema.text('site', [link.create({ href: 'https://e.com' }), underline.create()]),
        ]),
      ])
    );
    const md = new TextDecoder().decode(await markdownCodec.encode(doc));
    expect(md).toContain('[site](https://e.com)');
  });

  it('round-trips a checklist (checked and unchecked items)', async () => {
    const { paragraph, task_list, task_item } = schema.nodes;
    const doc = new Y.Doc();
    writePmDoc(
      doc,
      schema.topNodeType.create(null, [
        task_list.create(null, [
          task_item.create({ checked: true }, paragraph.create(null, schema.text('done'))),
          task_item.create({ checked: false }, paragraph.create(null, schema.text('todo'))),
        ]),
      ])
    );
    const bytes = await markdownCodec.encode(doc);
    const md = new TextDecoder().decode(bytes);
    expect(md).toContain('- [x] done');
    expect(md).toContain('- [ ] todo');

    const dst = new Y.Doc();
    await markdownCodec.decode(bytes, dst);
    const restored = readPmDoc(dst);
    expect(restored.firstChild?.type.name).toBe('task_list');
    expect(restored.firstChild?.child(0).type.name).toBe('task_item');
    expect(restored.firstChild?.child(0).attrs.checked).toBe(true);
    expect(restored.firstChild?.child(1).attrs.checked).toBe(false);
  });

  it('leaves a mixed checkbox/plain list as a plain bullet_list', async () => {
    const dst = new Y.Doc();
    await markdownCodec.decode(new TextEncoder().encode('- [ ] a\n- b\n'), dst);
    const restored = readPmDoc(dst);
    expect(restored.firstChild?.type.name).toBe('bullet_list');
    expect(restored.textContent).toContain('[ ] a');
  });

  it('round-trips a GFM table', async () => {
    const dst = new Y.Doc();
    await markdownCodec.decode(
      new TextEncoder().encode('| A | B |\n| --- | --- |\n| 1 | 2 |\n'),
      dst
    );
    const restored = readPmDoc(dst);
    expect(restored.firstChild?.type.name).toBe('table');
    expect(restored.firstChild?.firstChild?.firstChild?.type.name).toBe('table_header');
    expect(restored.firstChild?.child(1).firstChild?.type.name).toBe('table_cell');
    expect(restored.textContent).toContain('A');
    expect(restored.textContent).toContain('1');

    const bytes = await markdownCodec.encode(dst);
    const md = new TextDecoder().decode(bytes);
    expect(md).toContain('| A | B |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('round-trips a hard line break inside a table cell as literal <br>', async () => {
    const dst = new Y.Doc();
    await markdownCodec.decode(
      new TextEncoder().encode('| A |\n| --- |\n| one<br>two |\n'),
      dst
    );
    const restored = readPmDoc(dst);
    const cell = restored.firstChild?.child(1).firstChild;
    expect(cell?.type.name).toBe('table_cell');
    expect(cell?.childCount).toBe(3); // "one", hard_break, "two"
    expect(cell?.child(1).type.name).toBe('hard_break');
    expect(cell?.textContent).toBe('onetwo'); // hard_break itself carries no text

    const bytes = await markdownCodec.encode(dst);
    const md = new TextDecoder().decode(bytes);
    expect(md).toContain('one<br>two');
  });
});

describe('text codec', () => {
  it('keeps the visible text, one line per block', async () => {
    const restored = await roundTrip(textCodec);
    expect(restored.textContent).toContain('Title');
    expect(restored.textContent).toContain('one');
    expect(restored.textContent).toContain('two');
  });

  it('drops formatting (plain text only)', async () => {
    const txt = new TextDecoder().decode(await textCodec.encode(seeded()));
    expect(txt).not.toContain('~~');
    expect(txt).not.toContain('#');
    expect(txt).toContain('Title');
  });
});

describe('codec registry', () => {
  it('selects a codec by extension, case-insensitively', () => {
    expect(codecForFilename('notes.md').id).toBe('markdown');
    expect(codecForFilename('notes.MARKDOWN').id).toBe('markdown');
    expect(codecForFilename('a.txt').id).toBe('text');
    expect(codecForFilename('a.HTML').id).toBe('html');
    expect(codecForFilename('a.json').id).toBe('json');
    expect(codecForFilename('doc.yjs').id).toBe('yjs');
  });

  it('routes source-code extensions to the text codec', () => {
    const codeFiles = [
      'main.py', 'index.js', 'App.tsx', 'lib.rs', 'main.go',
      'Main.java', 'Program.cs', 'style.css', 'config.yml',
      'schema.graphql', 'main.sh', 'infra.tf', 'query.sql',
    ];
    for (const f of codeFiles) {
      expect(codecForFilename(f).id).toBe('text');
    }
  });

  it('falls back to the native yjs codec for unknown / missing extensions', () => {
    expect(codecForFilename('mystery.bin').id).toBe(DEFAULT_CODEC.id);
    expect(codecForFilename('noext').id).toBe('yjs');
  });

  it('exposes every known extension', () => {
    const exts = knownExtensions();
    expect(exts).toEqual(expect.arrayContaining([
      '.yjs', '.txt', '.md', '.html', '.json',
      '.py', '.js', '.ts', '.rs', '.go', '.yml', '.css', '.sql',
    ]));
  });
});
