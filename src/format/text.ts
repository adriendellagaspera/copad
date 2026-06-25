import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import type { Codec } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Plain text. Each line becomes a paragraph on import; on export each top-level
 * block is emitted as a line. Formatting (bold, headings, lists…) is flattened
 * to its text — that's the nature of `.txt`.
 */
export const textCodec: Codec = {
  id: 'text',
  label: 'Plain text',
  extensions: ['.txt'],

  decode(bytes, doc) {
    const text = decoder.decode(bytes);
    const paragraphs = text.split(/\r?\n/).map(line =>
      schema.nodes.paragraph.create(null, line ? schema.text(line) : undefined)
    );
    const node = schema.topNodeType.create(null, paragraphs);
    writePmDoc(doc, node);
  },

  encode(doc) {
    const node = readPmDoc(doc);
    const lines: string[] = [];
    node.forEach(block => lines.push(block.textContent));
    return encoder.encode(lines.join('\n'));
  },
};
