import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { tableNodeTypes } from 'prosemirror-tables';
import { schema } from './schema.js';
import { commands, runCommand, activeInputMarks, isInTable, isNodeActive, activeBlockLabel, activeBlockContext } from './commands.js';

function paragraphState(text = 'hi'): EditorState {
  const para = text ? schema.node('paragraph', null, schema.text(text)) : schema.node('paragraph');
  const doc = schema.node('doc', null, [para]);
  let state = EditorState.create({ schema, doc });
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

  it('horizontalRule splits the enclosing paragraph inside a table cell, same as outside any table — cells hold real block content now (see schema.ts), and the old guard blocking this was removed once that stopped corrupting the table', () => {
    const types = tableNodeTypes(schema);
    const cell = types.header_cell.create(null, [schema.nodes.paragraph.create(null, schema.text('x'))]);
    const doc = schema.node('doc', null, [types.table.create(null, [types.row.create(null, [cell])])]);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
    let dispatched = false;
    let next: typeof state | null = null;
    const handled = commands.horizontalRule(state, (tr) => {
      dispatched = true;
      next = state.apply(tr);
    });
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    const table = next!.doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(1);
  });

  it('insertTable creates a 3x3 table with a header row', () => {
    const next = apply(paragraphState(''), commands.insertTable);
    // child(0) is the leading escape-hatch paragraph — see the dedicated test below.
    const table = next.doc.child(1);
    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(3);
    expect(table?.firstChild?.firstChild?.type.name).toBe('table_header');
    expect(table?.child(1).firstChild?.type.name).toBe('table_cell');
  });

  it('insertTable parks the caret in the first header cell, not wherever replaceSelectionWith would default to', () => {
    const next = apply(paragraphState(''), commands.insertTable);
    const $from = next.selection.$from;
    // depth 1 = table, 2 = row, 3 = cell.
    expect($from.node(1).type.name).toBe('table');
    expect($from.node(2).type.name).toBe('table_row');
    expect($from.node(3).type.name).toBe('table_header');
    expect($from.index(2)).toBe(0);
    expect($from.index(1)).toBe(0);
  });

  it('insertTable on a doc with only an empty paragraph adds an empty paragraph on BOTH sides, so the table is never the doc\'s sole node — otherwise ArrowUp/ArrowDown at the table\'s edge has nothing to escape into and swallows the key (see tableArrowVertical), trapping the caret', () => {
    const next = apply(paragraphState(''), commands.insertTable);
    expect(next.doc.childCount).toBe(3);
    expect(next.doc.child(0).type.name).toBe('paragraph');
    expect(next.doc.child(1).type.name).toBe('table');
    expect(next.doc.child(2).type.name).toBe('paragraph');
  });

  it('insertTable does not add a spare paragraph on a side that already has a neighbouring block', () => {
    const before = schema.node('paragraph', null, schema.text('above'));
    const after = schema.node('paragraph', null, schema.text('below'));
    const empty = schema.node('paragraph');
    const doc = schema.node('doc', null, [before, empty, after]);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, before.nodeSize + 1)));
    const next = apply(state, commands.insertTable);
    expect(next.doc.childCount).toBe(3);
    expect(next.doc.child(0).textContent).toBe('above');
    expect(next.doc.child(1).type.name).toBe('table');
    expect(next.doc.child(2).textContent).toBe('below');
  });

  it('insertTable is a no-op inside an existing table', () => {
    const withTable = apply(paragraphState(''), commands.insertTable);
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
    expect(next.doc.child(1).childCount).toBe(4);
  });

  it('h1 toggles back to a paragraph when the block is already a level-1 heading', () => {
    const asH1 = apply(paragraphState('title'), commands.h1);
    expect(asH1.doc.firstChild?.type.name).toBe('heading');
    const back = apply(asH1, commands.h1);
    expect(back.doc.firstChild?.type.name).toBe('paragraph');
    expect(back.doc.firstChild?.textContent).toBe('title');
  });

  it('bullet toggles the block back to a paragraph when it is already a bullet list', () => {
    const asList = apply(paragraphState('item'), commands.bullet);
    expect(asList.doc.firstChild?.type.name).toBe('bullet_list');
    const back = apply(asList, commands.bullet);
    expect(back.doc.firstChild?.type.name).toBe('paragraph');
    expect(back.doc.firstChild?.textContent).toBe('item');
  });

  it('blockquote lifts back out instead of nesting a second blockquote on re-invoke', () => {
    const quoted = apply(paragraphState('q'), commands.blockquote);
    expect(quoted.doc.firstChild?.type.name).toBe('blockquote');
    const back = apply(quoted, commands.blockquote);
    expect(back.doc.firstChild?.type.name).toBe('paragraph');
    expect(back.doc.firstChild?.textContent).toBe('q');
  });

  it('isNodeActive detects a wrapping list/blockquote ancestor, not just the immediate textblock', () => {
    const asList = apply(paragraphState('x'), commands.bullet);
    expect(isNodeActive(asList, schema.nodes.bullet_list)).toBe(true);
    expect(isNodeActive(asList, schema.nodes.ordered_list)).toBe(false);
    const quoted = apply(paragraphState('y'), commands.blockquote);
    expect(isNodeActive(quoted, schema.nodes.blockquote)).toBe(true);
    const h2 = apply(paragraphState('z'), commands.h2);
    expect(isNodeActive(h2, schema.nodes.heading, { level: 2 })).toBe(true);
    expect(isNodeActive(h2, schema.nodes.heading, { level: 1 })).toBe(false);
  });

  it('runCommand executes against a view-like object without throwing', () => {
    // runCommand calls view.focus(), so the stub must carry one.
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
    const heading = apply(paragraphState(), commands.h2);
    expect(activeBlockContext(heading)).toEqual({ label: 'H2', pos: 1 });
  });

  it('anchors a quoted paragraph to the paragraph itself, not the blockquote', () => {
    const quote = apply(paragraphState(), commands.blockquote);
    const ctx = activeBlockContext(quote);
    expect(ctx?.label).toBe('Quote');
    expect(ctx?.pos).toBe(2);
  });
});
