import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import type { Codec } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Plain text / source code. Each line becomes a paragraph on import; on export
 * each top-level block is emitted as a line. Formatting is flattened to its
 * text — that's the nature of plain-text and source files.
 */
export const textCodec: Codec = {
  id: 'text',
  label: 'Plain text / Source code',
  extensions: [
    // Generic text
    '.txt', '.text', '.log', '.csv', '.tsv',
    // Web
    '.css', '.scss', '.sass', '.less',
    '.xml', '.svg', '.xsl', '.xslt',
    '.graphql', '.gql',
    // JavaScript / TypeScript
    '.js', '.mjs', '.cjs',
    '.jsx',
    '.ts', '.mts', '.cts',
    '.tsx',
    // Vue / Svelte / Angular templates
    '.vue', '.svelte', '.astro',
    // Systems languages
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
    // Scripting
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
    // Shell
    '.sh', '.bash', '.zsh', '.fish',
    '.ps1', '.psm1', '.psd1',
    '.bat', '.cmd',
    // Config / data
    '.yml', '.yaml',
    '.toml',
    '.ini', '.cfg', '.conf',
    '.env',
    '.jsonc', '.json5',
    // Infrastructure / build
    '.tf', '.hcl',
    '.nix',
    '.dockerfile',
    '.makefile',
    '.cmake',
    '.gradle',
    '.proto',
    '.sql',
    '.diff', '.patch',
  ],

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
