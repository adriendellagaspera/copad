import {
  MarkdownParser,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownSerializer,
} from 'prosemirror-markdown';
import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import type { Codec, FileExtension } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

// Reuse the markdown-it engine behind the default parser, but turn GFM
// strikethrough back on (the CommonMark preset ships it disabled) and map its
// `s` token to our `strike` mark — so `~~…~~` survives a full round-trip.
const MarkdownItClass = defaultMarkdownParser.tokenizer.constructor as new (
  preset: string,
  options: Record<string, unknown>,
) => typeof defaultMarkdownParser.tokenizer;
const tokenizer = new MarkdownItClass('commonmark', { html: false });
tokenizer.enable(['strikethrough']);

const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  s: { mark: 'strike' },
});

// The default serializer covers our basic+list nodes and em/strong/code/link;
// teach it our `strike` mark to match the parser above.
const serializer = new MarkdownSerializer(defaultMarkdownSerializer.nodes, {
  ...defaultMarkdownSerializer.marks,
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
});

/**
 * Markdown (CommonMark + GFM strikethrough). Maps cleanly onto our schema for
 * the structures Markdown can express (headings, lists, blockquotes, code,
 * emphasis, strikethrough…). Constructs our schema doesn't model are dropped on
 * import.
 */
export const markdownCodec: Codec = {
  id: 'markdown',
  label: 'Markdown',
  extensions: ['.md', '.markdown'] as FileExtension[],

  decode(bytes, doc) {
    const parsed = parser.parse(decoder.decode(bytes));
    if (!parsed) throw new Error('Markdown: could not parse document');
    writePmDoc(doc, parsed);
  },

  encode(doc) {
    return encoder.encode(serializer.serialize(readPmDoc(doc)));
  },
};
