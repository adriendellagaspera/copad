import type { Node as PMNode, Mark } from 'prosemirror-model';

/**
 * IO-boundary accessors for ProseMirror node/mark attrs, which are typed as
 * `any` by the library. Each function is the single cast site for its attr.
 */

/** The heading level of a heading node (falls back to 1 for malformed data). */
export function headingLevel(node: PMNode): number {
  const raw = node.attrs['level'];
  return typeof raw === 'number' ? raw : 1;
}

/** The href of a link mark, or null when absent or not a string. */
export function linkHref(mark: Mark): string | null {
  const raw = mark.attrs['href'];
  return typeof raw === 'string' ? raw : null;
}
