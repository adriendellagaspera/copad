import { DOMParser as PMDOMParser, DOMSerializer } from 'prosemirror-model';
import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import type { Codec } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function requireDom(): void {
  if (
    typeof window === 'undefined' ||
    typeof window.DOMParser === 'undefined' ||
    typeof document === 'undefined'
  ) {
    throw new Error('HTML format requires a browser environment');
  }
}

/**
 * HTML, via ProseMirror's own DOM parser/serializer driven by our schema — so
 * the tags we understand (headings, lists, blockquotes, bold/italic/strike…)
 * round-trip, and unknown markup is dropped to plain structure on import.
 * Requires a DOM, so it only runs in the browser.
 */
export const htmlCodec: Codec = {
  id: 'html',
  label: 'HTML',
  extensions: ['.html', '.htm'],

  decode(bytes, doc) {
    requireDom();
    const dom = new window.DOMParser().parseFromString(decoder.decode(bytes), 'text/html');
    writePmDoc(doc, PMDOMParser.fromSchema(schema).parse(dom.body));
  },

  encode(doc) {
    requireDom();
    const node = readPmDoc(doc);
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document });
    const container = document.createElement('div');
    container.appendChild(fragment);
    return encoder.encode(container.innerHTML);
  },
};
