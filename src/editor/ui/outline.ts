import type { Node as PMNode } from 'prosemirror-model';
import { headingLevel } from '../parse.js';
import { nodeNameOf } from '../schema.js';

/** A heading's depth, 1–6 as the schema allows. */
export type HeadingLevel = number & { readonly _brand: 'HeadingLevel' };

/** A heading's text as the outline shows it — never empty, see {@link UNTITLED}. */
export type HeadingText = string & { readonly _brand: 'HeadingText' };

/** A position in the ProseMirror document. Valid only against the doc it was read from. */
export type DocPos = number & { readonly _brand: 'DocPos' };

/** One heading in the document, in document order. */
export interface DocHeading {
  readonly level: HeadingLevel;
  readonly text: HeadingText;
  readonly pos: DocPos;
}

const UNTITLED = 'Untitled' as HeadingText;

/** Every heading in `doc`, in document order. Walks the whole tree — call it
 *  through {@link memoiseHeadings} rather than on every transaction. */
export function headingsOf(doc: PMNode): DocHeading[] {
  const headings: DocHeading[] = [];
  doc.descendants((node, pos) => {
    if (nodeNameOf(node) !== 'heading') return;
    headings.push({
      level: headingLevel(node) as HeadingLevel,
      text: (node.textContent || UNTITLED) as HeadingText,
      pos: pos as DocPos,
    });
  });
  return headings;
}

/**
 * A reader that re-walks only when the document itself changed.
 *
 * The walk cannot run per transaction: under y-prosemirror a peer's single
 * keystroke arrives as a transaction replacing the whole document, so an
 * unguarded caller re-walks on every remote keystroke as well as on every
 * local selection change. ProseMirror nodes are immutable, so reference
 * identity is the `docChanged` check — no deep comparison, no invalidation to
 * get wrong.
 */
export function memoiseHeadings(): (doc: PMNode | null) => DocHeading[] {
  let lastDoc: PMNode | null = null;
  let lastHeadings: DocHeading[] = [];
  return (doc) => {
    if (doc === lastDoc) return lastHeadings;
    lastDoc = doc;
    lastHeadings = doc ? headingsOf(doc) : [];
    return lastHeadings;
  };
}
