import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';
import { normalizeHref, isValidHref, setLink, currentLinkHref, removeLink, linkAround } from './linkCommands.js';

function stateWith(text: string): EditorState {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]);
  return EditorState.create({ schema, doc });
}

function selectAll(state: EditorState): EditorState {
  const sel = TextSelection.create(state.doc, 1, state.doc.firstChild!.content.size + 1);
  return state.apply(state.tr.setSelection(sel));
}

describe('normalizeHref', () => {
  it('adds https:// to a bare host', () => {
    expect(normalizeHref('example.com')).toBe('https://example.com');
  });
  it('leaves an existing scheme untouched', () => {
    expect(normalizeHref('http://x.io')).toBe('http://x.io');
    expect(normalizeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
  });
  it('keeps relative and anchor links', () => {
    expect(normalizeHref('/path')).toBe('/path');
    expect(normalizeHref('#section')).toBe('#section');
  });
  it('turns a bare email into a mailto: link', () => {
    expect(normalizeHref('a@b.com')).toBe('mailto:a@b.com');
  });
  it('returns empty for blank input', () => {
    expect(normalizeHref('   ')).toBe('');
  });
});

describe('isValidHref', () => {
  it('accepts bare domains, IPs, and localhost', () => {
    expect(isValidHref('example.com')).toBe(true);
    expect(isValidHref('sub.example.co.uk/path')).toBe(true);
    expect(isValidHref('192.168.1.1')).toBe(true);
    expect(isValidHref('localhost:3000')).toBe(true);
  });
  it('accepts explicit schemes, relative paths, anchors, and emails', () => {
    expect(isValidHref('http://x.io')).toBe(true);
    expect(isValidHref('ftp://server')).toBe(true);
    expect(isValidHref('/path')).toBe(true);
    expect(isValidHref('#section')).toBe(true);
    expect(isValidHref('a@b.com')).toBe(true);
  });
  it('rejects plain words that normalizeHref would silently prefix with https://', () => {
    expect(isValidHref('todo')).toBe(false);
    expect(isValidHref('not a link')).toBe(false);
  });
  it('rejects input containing whitespace', () => {
    expect(isValidHref('exa mple.com')).toBe(false);
  });
  it('treats blank input as valid (handled separately as link removal)', () => {
    expect(isValidHref('   ')).toBe(true);
  });
});

describe('link commands', () => {
  it('applies a link mark over the selection', () => {
    let state = selectAll(stateWith('hello'));
    const applied = setLink('example.com')(state, (tr) => {
      state = state.apply(tr);
    });
    expect(applied).toBe(true);
    expect(currentLinkHref(state)).toBe('https://example.com');
  });

  it('refuses to apply with an empty selection', () => {
    const state = stateWith('hello'); // cursor at start, empty selection
    expect(setLink('example.com')(state, () => {})).toBe(false);
  });

  it('removes an existing link', () => {
    let state = selectAll(stateWith('hello'));
    setLink('example.com')(state, (tr) => (state = state.apply(tr)));
    expect(currentLinkHref(state)).not.toBeNull();
    state = selectAll(state);
    removeLink(state, (tr) => (state = state.apply(tr)));
    expect(currentLinkHref(state)).toBeNull();
  });
});

describe('linkAround (whole-link range from a bare caret mid-link)', () => {
  it('returns the full link span + href from a caret resting in the MIDDLE of the link (not just its trailing edge)', () => {
    let state = selectAll(stateWith('hello'));
    setLink('example.com')(state, (tr) => (state = state.apply(tr)));
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    const found = linkAround(state);
    expect(found).not.toBeNull();
    expect(found!.href).toBe('https://example.com');
    expect(found!.from).toBe(1);
    expect(found!.to).toBe(6);
  });

  it('returns null for a caret that is not on any link', () => {
    const state = stateWith('plain text');
    expect(linkAround(state)).toBeNull();
  });

  it('returns null for a caret resting right after a link, before unlinked text', () => {
    // The link mark is `inclusive: false`, so a caret at its trailing edge is off the link.
    let state = stateWith('hello world');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
    setLink('example.com')(state, (tr) => (state = state.apply(tr)));
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)));
    expect(linkAround(state)).toBeNull();
  });

  it('detects a link that is the first word of a paragraph, caret at its very start', () => {
    // At a parent's own start $from.marks() has no preceding sibling, so it drops an
    // inclusive:false mark there too.
    let state = selectAll(stateWith('hello'));
    setLink('example.com')(state, (tr) => (state = state.apply(tr)));
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    const found = linkAround(state);
    expect(found).not.toBeNull();
    expect(found!.from).toBe(1);
    expect(found!.to).toBe(6);
  });

  it('detects a link that is the last word of a paragraph, caret at its very end', () => {
    let state = selectAll(stateWith('hello'));
    setLink('example.com')(state, (tr) => (state = state.apply(tr)));
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)));
    const found = linkAround(state);
    expect(found).not.toBeNull();
    expect(found!.from).toBe(1);
    expect(found!.to).toBe(6);
  });
});
