import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';
import { commands, runCommand, activeInputMarks } from './commands.js';

function paragraphState(text = 'hi'): EditorState {
  const para = text ? schema.node('paragraph', null, schema.text(text)) : schema.node('paragraph');
  const doc = schema.node('doc', null, [para]);
  let state = EditorState.create({ schema, doc });
  // place cursor inside the paragraph
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  return state;
}

function apply(state: EditorState, cmd: (typeof commands)[keyof typeof commands]): EditorState {
  let next = state;
  cmd(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

describe('block commands', () => {
  it('h3 turns the block into a level-3 heading', () => {
    const next = apply(paragraphState(), commands.h3);
    expect(next.doc.firstChild?.type.name).toBe('heading');
    expect(next.doc.firstChild?.attrs.level).toBe(3);
  });

  it('codeBlock turns the block into a code_block', () => {
    const next = apply(paragraphState(), commands.codeBlock);
    expect(next.doc.firstChild?.type.name).toBe('code_block');
  });

  it('horizontalRule inserts a horizontal_rule node', () => {
    const next = apply(paragraphState(''), commands.horizontalRule);
    let found = false;
    next.doc.descendants((n) => {
      if (n.type.name === 'horizontal_rule') found = true;
    });
    expect(found).toBe(true);
  });

  it('runCommand executes against a view-like object without throwing', () => {
    // runCommand calls view.focus(); provide a minimal stub.
    const state = paragraphState();
    let dispatched = false;
    const view = {
      state,
      dispatch: () => {
        dispatched = true;
      },
      focus: () => {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runCommand(view as any, commands.h1);
    expect(dispatched).toBe(true);
  });
});

describe('activeInputMarks', () => {
  const names = (state: EditorState) => activeInputMarks(state).map((t) => t.name).sort();

  it('is empty for a plain collapsed caret', () => {
    expect(activeInputMarks(paragraphState())).toEqual([]);
  });

  it('reports a mark armed by a toggle at the caret (stored marks)', () => {
    const armed = apply(paragraphState(), commands.bold);
    expect(names(armed)).toEqual(['strong']);
  });

  it('reports marks inherited from the caret position', () => {
    // A paragraph whose text carries the strong mark; caret placed inside it.
    const strong = schema.marks.strong.create();
    const para = schema.node('paragraph', null, schema.text('hi', [strong]));
    const doc = schema.node('doc', null, [para]);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    expect(names(state)).toEqual(['strong']);
  });

  it('is empty for a non-collapsed selection (the selection toolbar covers that)', () => {
    let state = paragraphState('hello');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 4)));
    expect(activeInputMarks(state)).toEqual([]);
  });
});
