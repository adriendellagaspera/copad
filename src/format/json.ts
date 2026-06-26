import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import type { Codec } from './types.js';
import { extensionOf } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * ProseMirror document JSON. The richest non-native format — it captures every
 * node and mark in our schema exactly, so it round-trips losslessly (it just
 * doesn't carry the CRDT history the way `.yjs` does).
 */
export const jsonCodec: Codec = {
  id: 'json',
  label: 'ProseMirror JSON',
  extensions: [extensionOf('.json')],

  decode(bytes, doc) {
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    const node = schema.nodeFromJSON(parsed);
    writePmDoc(doc, node);
  },

  encode(doc) {
    const json = JSON.stringify(readPmDoc(doc).toJSON(), null, 2);
    return encoder.encode(json);
  },
};
