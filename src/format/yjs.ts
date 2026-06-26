import * as Y from 'yjs';
import type { Codec, FileExtension } from './types.js';

/**
 * Native Copad format: the raw Yjs CRDT update. Unlike the content codecs this
 * round-trips the full collaborative state (history included), so merging two
 * independently-edited copies is conflict-free. This is the default whenever a
 * file has no recognised content extension.
 */
export const yjsCodec: Codec = {
  id: 'yjs',
  label: 'Copad document',
  extensions: ['.yjs' as FileExtension],

  decode(bytes, doc) {
    Y.applyUpdate(doc, bytes);
  },

  encode(doc) {
    return Y.encodeStateAsUpdate(doc);
  },
};
