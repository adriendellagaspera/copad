import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { schema } from '../editor/schema.js';
import { writePmDoc } from './pm.js';
import { docxCodec } from './docx.js';

describe('docx codec', () => {
  it('is a one-way export codec (no decode)', () => {
    expect(docxCodec.id).toBe('docx');
    expect(docxCodec.extensions).toEqual(['.docx']);
    expect('decode' in docxCodec).toBe(false);
  });

  it('lazily encodes via a dynamic import of docxEncode.ts', async () => {
    const doc = new Y.Doc();
    writePmDoc(doc, schema.topNodeType.create(null, [schema.nodes.paragraph.create(null, schema.text('hi'))]));
    const bytes = await docxCodec.encode(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(0x50); // ZIP local file header magic number
    expect(bytes[1]).toBe(0x4b);
  });
});
