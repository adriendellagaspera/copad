import type * as Y from 'yjs';
import type { Node } from 'prosemirror-model';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { schema } from '../editor/schema.js';

// Must match the fragment name ySyncPlugin binds to in Editor.svelte.
const FRAGMENT = 'prosemirror';

// Diff-reconciles rather than appends, so writing into a non-empty fragment stays correct.
export function writePmDoc(doc: Y.Doc, node: Node): void {
  prosemirrorToYXmlFragment(node, doc.getXmlFragment(FRAGMENT));
}

export function readPmDoc(doc: Y.Doc): Node {
  return yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), schema);
}
