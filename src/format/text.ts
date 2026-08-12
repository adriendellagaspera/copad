import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import type { Codec } from './types.js';
import { extensionOf } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export const textCodec: Codec = {
  id: 'text',
  label: 'Plain text / Source code',
  extensions: [
    '.txt', '.text', '.log', '.csv', '.tsv',
    '.css', '.scss', '.sass', '.less',
    '.xml', '.svg', '.xsl', '.xslt',
    '.graphql', '.gql',
    '.js', '.mjs', '.cjs',
    '.jsx',
    '.ts', '.mts', '.cts',
    '.tsx',
    '.vue', '.svelte', '.astro',
    '.c', '.h',
    '.cpp', '.cc', '.cxx', '.hpp', '.hxx',
    '.cs',
    '.java',
    '.rs',
    '.go',
    '.swift',
    '.kt', '.kts',
    '.scala',
    '.dart',
    '.py', '.pyw',
    '.rb',
    '.pl', '.pm',
    '.lua',
    '.r', '.rmd',
    '.ex', '.exs',
    '.clj', '.cljs',
    '.hs', '.lhs',
    '.ml', '.mli',
    '.fs', '.fsx',
    '.php',
    '.sh', '.bash', '.zsh', '.fish',
    '.ps1', '.psm1', '.psd1',
    '.bat', '.cmd',
    '.yml', '.yaml',
    '.toml',
    '.ini', '.cfg', '.conf',
    '.env',
    '.jsonc', '.json5',
    '.tf', '.hcl',
    '.nix',
    '.dockerfile',
    '.makefile',
    '.cmake',
    '.gradle',
    '.proto',
    '.sql',
    '.diff', '.patch',
  ].map(extensionOf),

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
