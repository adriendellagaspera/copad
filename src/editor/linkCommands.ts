import type { Command, EditorState } from 'prosemirror-state';
import { schema } from './schema.js';
import { linkHref } from './parse.js';

const linkType = schema.marks.link;

/** Normalise a user-typed URL: add https:// when no scheme and it looks like a host. */
export function normalizeHref(input: string): string {
  const href = input.trim();
  if (!href) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) {
    return href;
  }
  if (href.startsWith('mailto:') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) {
    return href.includes(':') ? href : `mailto:${href}`;
  }
  return `https://${href}`;
}

/** The href of the link mark touching the current selection, or null. */
export function currentLinkHref(state: EditorState): string | null {
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    const mark = linkType.isInSet(state.storedMarks ?? $from.marks());
    return mark ? linkHref(mark) : null;
  }
  let href: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    const mark = node.marks.find((m) => m.type === linkType);
    if (mark) href = linkHref(mark);
  });
  return href;
}

/** True when the selection sits on or within a link. */
export function isLinkActive(state: EditorState): boolean {
  return currentLinkHref(state) !== null;
}

/** Apply (or replace) a link mark over the current selection. */
export function setLink(rawHref: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false; // need text to wrap
    const href = normalizeHref(rawHref);
    if (!href) return false;
    if (dispatch) {
      dispatch(
        state.tr
          .removeMark(from, to, linkType)
          .addMark(from, to, linkType.create({ href }))
          .scrollIntoView()
      );
    }
    return true;
  };
}

/** Remove any link mark touching the selection. */
export const removeLink: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (dispatch) {
    if (empty) dispatch(state.tr.removeStoredMark(linkType));
    else dispatch(state.tr.removeMark(from, to, linkType));
  }
  return true;
};
