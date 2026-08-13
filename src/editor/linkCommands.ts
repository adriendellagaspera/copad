import type { Command, EditorState } from 'prosemirror-state';
import { schema } from './schema.js';
import { linkHref } from './parse.js';

const linkType = schema.marks.link;

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

function looksLikeHost(input: string): boolean {
  const host = input.split(/[/?#]/)[0].split(':')[0];
  return host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes('.');
}

export function isValidHref(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return true; // empty means "remove the link", handled by the caller
  // The WHATWG URL parser percent-encodes spaces in the host rather than rejecting them.
  if (/\s/.test(trimmed)) return false;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const isRelative = trimmed.startsWith('/') || trimmed.startsWith('#');
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  if (!hasScheme && !isRelative && !isEmail && !looksLikeHost(trimmed)) return false;
  try {
    new URL(normalizeHref(trimmed), 'https://copad.invalid');
    return true;
  } catch {
    return false;
  }
}

export function linkAround(state: EditorState): { href: string; from: number; to: number } | null {
  const { $from, from, to, empty } = state.selection;
  if (!empty) {
    let href: string | null = null;
    state.doc.nodesBetween(from, to, (node) => {
      if (href) return;
      const mark = node.marks.find((m) => m.type === linkType);
      const h = mark ? linkHref(mark) : null;
      if (h) href = h;
    });
    return href ? { href, from, to } : null;
  }
  const parent = $from.parent;
  const index = $from.index();
  // $from.marks() honours the link mark's `inclusive: false`, unlike a raw neighbour lookup.
  let mark = linkType.isInSet(state.storedMarks ?? $from.marks());
  // It also drops the mark at the very start/end of the parent, where there is no
  // sibling to compare against — a missing-neighbour artifact, not a link boundary.
  if (!mark && $from.textOffset === 0) {
    if (index === 0) mark = linkType.isInSet(parent.maybeChild(0)?.marks ?? []);
    else if (index === parent.childCount) mark = linkType.isInSet(parent.maybeChild(index - 1)?.marks ?? []);
  }
  if (!mark) return null;
  const startOfParent = $from.start();
  let startIndex = $from.textOffset > 0 ? index : Math.max(0, index - 1);
  let endIndex = startIndex;
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) startIndex--;
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) endIndex++;
  let fromPos = startOfParent;
  for (let i = 0; i < startIndex; i++) fromPos += parent.child(i).nodeSize;
  let toPos = fromPos;
  for (let i = startIndex; i < endIndex; i++) toPos += parent.child(i).nodeSize;
  const href = linkHref(mark);
  return href ? { href, from: fromPos, to: toPos } : null;
}

export function currentLinkHref(state: EditorState): string | null {
  return linkAround(state)?.href ?? null;
}

export function isLinkActive(state: EditorState): boolean {
  return currentLinkHref(state) !== null;
}

export function setLink(rawHref: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
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

export const removeLink: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (dispatch) {
    if (empty) dispatch(state.tr.removeStoredMark(linkType));
    else dispatch(state.tr.removeMark(from, to, linkType));
  }
  return true;
};
