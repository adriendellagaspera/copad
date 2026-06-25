import type * as Y from 'yjs';
import type { Node } from 'prosemirror-model';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { schema } from '../editor/schema.js';

// The shared XML fragment the editor binds to (see Editor.svelte / ySyncPlugin).
const FRAGMENT = 'prosemirror';

/**
 * Reconcile a parsed ProseMirror document into the shared doc, replacing its
 * current content. Uses y-prosemirror's diff reconciler (the same one the sync
 * plugin uses), so writing into a non-empty fragment produces a minimal update
 * rather than appending — no duplicated leading paragraph.
 */
export function writePmDoc(doc: Y.Doc, node: Node): void {
  prosemirrorToYXmlFragment(node, doc.getXmlFragment(FRAGMENT));
}

/** Read the shared doc's content back out as a ProseMirror document node. */
export function readPmDoc(doc: Y.Doc): Node {
  return yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), schema);
}
