// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import type { Decoration } from 'prosemirror-view';
import { schema } from '../schema.js';
import { commands } from '../commands.js';
import { lineBlockHintPlugin } from './lineBlockHint.js';

const plugin = lineBlockHintPlugin();

/** `plugin.props.decorations` is typed with `this: Plugin`, and its return
 * type is the general `DecorationSource` union — narrow both here so the
 * rest of the test file can use `DecorationSet`'s concrete `.find()`. */
function getDecorations(state: EditorState): DecorationSet | null {
  const result = plugin.props.decorations?.call(plugin, state);
  return (result as DecorationSet | null | undefined) ?? null;
}

function toDOM(d: Decoration): HTMLElement {
  // `.type.toDOM` isn't part of Decoration's public TS surface, but it's how
  // ProseMirror itself renders a widget decoration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (d as any).type.toDOM(undefined, undefined);
}

function paragraphState(): EditorState {
  const para = schema.node('paragraph', null, schema.text('hi'));
  const doc = schema.node('doc', null, [para]);
  let state = EditorState.create({ schema, doc, plugins: [plugin] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  return state;
}

function focusedHeadingState(level: 1 | 2 | 3): EditorState {
  const state = paragraphState();
  const cmd = { 1: commands.h1, 2: commands.h2, 3: commands.h3 }[level];
  let next = state;
  cmd(state, (tr) => {
    next = state.apply(tr);
  });
  return next.apply(next.tr.setMeta(plugin, { focused: true }));
}

function decorationLabels(state: EditorState): string[] {
  const decorations = getDecorations(state);
  if (!decorations) return [];
  return decorations.find().map((d) => toDOM(d).textContent ?? '');
}

describe('lineBlockHintPlugin', () => {
  it('shows no decoration while unfocused, even in a heading', () => {
    let state = paragraphState();
    commands.h2(state, (tr) => {
      state = state.apply(tr);
    });
    expect(getDecorations(state)).toBeNull();
  });

  it('shows the heading level once focused', () => {
    expect(decorationLabels(focusedHeadingState(1))).toEqual(['H1']);
    expect(decorationLabels(focusedHeadingState(2))).toEqual(['H2']);
    expect(decorationLabels(focusedHeadingState(3))).toEqual(['H3']);
  });

  it('shows nothing for a plain focused paragraph', () => {
    const base = paragraphState();
    const state = base.apply(base.tr.setMeta(plugin, { focused: true }));
    expect(getDecorations(state)).toBeNull();
  });

  it('renders the widget as non-editable and hidden from assistive tech', () => {
    const state = focusedHeadingState(1);
    const widget = getDecorations(state)?.find()[0];
    expect(widget).toBeDefined();
    const el = toDOM(widget!);
    expect(el.contentEditable).toBe('false');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toBe('line-hint-inline');
  });
});
