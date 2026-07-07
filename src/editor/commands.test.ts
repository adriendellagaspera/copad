import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';
import { commands, runCommand, activeInputMarks, activeBlockLabel, activeBlockContext } from './commands.js';

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

describe('activeBlockLabel', () => {
  it('is null for a plain paragraph', () => {
    expect(activeBlockLabel(paragraphState())).toBeNull();
  });

  it('reports the heading level', () => {
    const h2 = apply(paragraphState(), commands.h2);
    expect(activeBlockLabel(h2)).toBe('H2');

    const h3 = apply(paragraphState(), commands.h3);
    expect(activeBlockLabel(h3)).toBe('H3');
  });

  it('reports a code block', () => {
    const codeBlock = apply(paragraphState(), commands.codeBlock);
    expect(activeBlockLabel(codeBlock)).toBe('Code');
  });

  it('reports a blockquote', () => {
    const quote = apply(paragraphState(), commands.blockquote);
    expect(activeBlockLabel(quote)).toBe('Quote');
  });

  it('still reports the block for a non-collapsed selection (a line concept, not a mark-arming one)', () => {
    let state = apply(paragraphState(), commands.h1);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 2)));
    expect(activeBlockLabel(state)).toBe('H1');
  });
});

describe('activeBlockContext', () => {
  it('anchors to the start of the current line, not the matched ancestor', () => {
    // A heading anchors to its own start (the whole node is one line).
    const heading = apply(paragraphState(), commands.h2);
    expect(activeBlockContext(heading)).toEqual({ label: 'H2', pos: 1 });
  });

  it('anchors a quoted paragraph to the paragraph itself, not the blockquote', () => {
    const quote = apply(paragraphState(), commands.blockquote);
    // blockquote > paragraph > "hi": the paragraph's own content starts one
    // position deeper than the blockquote's.
    const ctx = activeBlockContext(quote);
    expect(ctx?.label).toBe('Quote');
    expect(ctx?.pos).toBe(2);
  });
});
