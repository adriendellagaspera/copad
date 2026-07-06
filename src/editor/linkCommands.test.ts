import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';
import { normalizeHref, isValidHref, setLink, currentLinkHref, removeLink } from './linkCommands.js';

function stateWith(text: string): EditorState {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]);
  return EditorState.create({ schema, doc });
}

/** Select the whole first paragraph's text. */
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
