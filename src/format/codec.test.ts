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

  it('falls back to the native yjs codec for unknown / missing extensions', () => {
    expect(codecForFilename('mystery.bin').id).toBe(DEFAULT_CODEC.id);
    expect(codecForFilename('noext').id).toBe('yjs');
  });

  it('exposes every known extension', () => {
    const exts = knownExtensions();
    expect(exts).toEqual(expect.arrayContaining(['.yjs', '.txt', '.md', '.html', '.json']));
  });
});
