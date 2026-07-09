import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';
import { commands, runCommand, activeInputMarks, isInTable, activeBlockLabel, activeBlockContext } from './commands.js';

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

  it('taskList wraps the block in a task_list/task_item', () => {
    const next = apply(paragraphState(), commands.taskList);
    expect(next.doc.firstChild?.type.name).toBe('task_list');
    const item = next.doc.firstChild?.firstChild;
    expect(item?.type.name).toBe('task_item');
    expect(item?.attrs.checked).toBe(false);
  });

  it('horizontalRule inserts a horizontal_rule node', () => {
    const next = apply(paragraphState(''), commands.horizontalRule);
    let found = false;
    next.doc.descendants((n) => {
      if (n.type.name === 'horizontal_rule') found = true;
    });
    expect(found).toBe(true);
  });

  it('insertTable creates a 3x3 table with a header row', () => {
    const next = apply(paragraphState(''), commands.insertTable);
    const table = next.doc.firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(3);
    expect(table?.firstChild?.firstChild?.type.name).toBe('table_header');
    expect(table?.child(1).firstChild?.type.name).toBe('table_cell');
  });

  it('insertTable parks the caret in the first header cell, not wherever replaceSelectionWith would default to', () => {
    const next = apply(paragraphState(''), commands.insertTable);
    const $from = next.selection.$from;
    // depth 1 = table, depth 2 = row, depth 3 = the cell the caret sits in.
    expect($from.node(1).type.name).toBe('table');
    expect($from.node(2).type.name).toBe('table_row');
    expect($from.node(3).type.name).toBe('table_header');
    expect($from.index(2)).toBe(0); // first cell of the first row
    expect($from.index(1)).toBe(0); // first row of the table
  });

  it('insertTable is a no-op inside an existing table', () => {
    const withTable = apply(paragraphState(''), commands.insertTable);
    // Move the cursor inside the first header cell.
    let cellPos = -1;
    withTable.doc.descendants((node, pos) => {
      if (node.type.name === 'table_header' && cellPos === -1) cellPos = pos + 1;
    });
    let state = withTable.apply(withTable.tr.setSelection(TextSelection.create(withTable.doc, cellPos)));
    expect(isInTable(state)).toBe(true);
    let dispatchCalled = false;
    commands.insertTable(state, () => {
      dispatchCalled = true;
    });
    expect(dispatchCalled).toBe(false);
  });

  it('addRowAfter grows the table from 3 to 4 rows', () => {
    const withTable = apply(paragraphState(''), commands.insertTable);
    let cellPos = -1;
    withTable.doc.descendants((node, pos) => {
      if (node.type.name === 'table_cell' && cellPos === -1) cellPos = pos + 1;
    });
    const state = withTable.apply(withTable.tr.setSelection(TextSelection.create(withTable.doc, cellPos)));
    const next = apply(state, commands.addRowAfter);
    expect(next.doc.firstChild?.childCount).toBe(4);
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

  it('reports underline armed by its toggle at the caret', () => {
    const armed = apply(paragraphState(), commands.underline);
    expect(names(armed)).toEqual(['underline']);
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
