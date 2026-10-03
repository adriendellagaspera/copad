// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import * as Y from 'yjs';
import { schema } from '../editor/schema.js';
import { readPmDoc, writePmDoc } from './pm.js';
import { htmlCodec } from './html.js';
import { jsonCodec } from './json.js';
import { markdownCodec } from './markdown.js';
import { textCodec } from './text.js';
import { yjsCodec } from './yjs.js';
import type { Codec } from './types.js';

const lineArbitrary = fc.stringMatching(/^[A-Za-z0-9](?:[A-Za-z0-9 ]{0,38}[A-Za-z0-9])?$/);
const documentArbitrary = fc.array(lineArbitrary, { minLength: 1, maxLength: 8 });

function plainDocument(lines: string[]) {
  const paragraphs = lines.map((line) => schema.nodes.paragraph.create(null, schema.text(line)));
  return schema.topNodeType.create(null, paragraphs);
}

async function roundTrip(codec: Codec, lines: string[]) {
  const expected = plainDocument(lines);
  const source = new Y.Doc();
  writePmDoc(source, expected);

  const bytes = await codec.encode(source);
  const restored = new Y.Doc();
  await codec.decode(bytes, restored);

  return { expected: expected.toJSON(), actual: readPmDoc(restored).toJSON() };
}

const codecs = [
  ['Yjs', yjsCodec],
  ['JSON', jsonCodec],
  ['Markdown', markdownCodec],
  ['HTML', htmlCodec],
  ['plain text', textCodec],
] as const;

describe.each(codecs)('%s codec property', (_name, codec) => {
  it('round-trips arbitrary plain-paragraph documents without changing their structure', async () => {
    await fc.assert(
      fc.asyncProperty(documentArbitrary, async (lines) => {
        const { expected, actual } = await roundTrip(codec, lines);
        expect(actual).toEqual(expected);
      }),
    );
  });
});
