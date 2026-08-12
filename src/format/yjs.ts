import * as Y from 'yjs';
import type { Codec } from './types.js';
import { extensionOf } from './types.js';

export const yjsCodec: Codec = {
  id: 'yjs',
  label: 'Copad document',
  extensions: [extensionOf('.yjs')],

  decode(bytes, doc) {
    Y.applyUpdate(doc, bytes);
  },

  encode(doc) {
    return Y.encodeStateAsUpdate(doc);
  },
};
