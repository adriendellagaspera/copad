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

/** True for a bare host normalizeHref would prepend https:// to — a real domain, localhost, or an IP. */
function looksLikeHost(input: string): boolean {
  const host = input.split(/[/?#]/)[0].split(':')[0];
  return host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes('.');
}

/**
 * True when `input` is a well-formed link, not just text that normalizeHref
 * happened to be able to bolt a scheme onto. Rejects plain words like "todo"
 * (normalizeHref would silently turn that into "https://todo") while still
 * accepting bare domains/IPs, explicit schemes, relative paths, and emails.
 * A raw space always means free text, not a URL: the WHATWG URL parser
 * (unlike Node's) percent-encodes spaces in the host instead of rejecting
 * them, so it can't be relied on alone for that case either.
 */
export function isValidHref(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return true; // empty is handled separately (removes the link)
  if (/\s/.test(trimmed)) return false;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const isRelative = trimmed.startsWith('/') || trimmed.startsWith('#');
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  if (!hasScheme && !isRelative && !isEmail && !looksLikeHost(trimmed)) return false;
  try {
    // A fixed base — only relative/anchor hrefs ever resolve against it, and
    // they're not host-shaped text either way, so the actual origin is moot.
    new URL(normalizeHref(trimmed), 'https://copad.invalid');
    return true;
  } catch {
    return false;
  }
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
