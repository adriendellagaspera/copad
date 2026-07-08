// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../schema.js';
import { tableElementAt, positionTablePanels, type Rect } from './tableAnchor.js';

const VIEWPORT = { width: 1000, height: 800 };
const GAP = 8;

function tableDoc(): ReturnType<typeof schema.node> {
  // cellContent is 'inline*' (see schema.ts) — cells hold inline content
  // directly, no wrapping paragraph.
  const cell = (text: string) => schema.node('table_cell', null, schema.text(text));
  const headerCell = (text: string) => schema.node('table_header', null, schema.text(text));
  const headerRow = schema.node('table_row', null, [headerCell('A'), headerCell('B')]);
  const bodyRow = schema.node('table_row', null, [cell('1'), cell('2')]);
  const table = schema.node('table', null, [headerRow, bodyRow]);
  return schema.node('doc', null, [table, schema.node('paragraph', null, schema.text('after'))]);
}

function mountView(doc: ReturnType<typeof schema.node>): EditorView {
  const state = EditorState.create({ schema, doc });
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  const view = new EditorView(dom, {
    state,
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
    },
  });
  return view;
}

/** A position inside the given text node's run, found by content rather than
 *  a hardcoded offset — resilient to schema/structure changes. */
function textPos(doc: ReturnType<typeof schema.node>, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos + 1;
  });
  if (found === -1) throw new Error(`no text node "${text}" found`);
  return found;
}

describe('tableElementAt', () => {
  it('finds the ancestor <table> for a position inside a cell', () => {
    const doc = tableDoc();
    const view = mountView(doc);
    const pos = textPos(doc, 'A'); // inside the first header cell's text
    const table = tableElementAt(view, pos);
    expect(table?.tagName).toBe('TABLE');
    view.destroy();
  });

  it('returns null for a position outside any table', () => {
    const doc = tableDoc();
    const view = mountView(doc);
    const pos = textPos(doc, 'after'); // the trailing paragraph, outside the table
    expect(tableElementAt(view, pos)).toBeNull();
    view.destroy();
  });
});

describe('positionTablePanels', () => {
  const table: Rect = { top: 300, left: 400, right: 600, bottom: 360, width: 200, height: 60 };
  const textSize = { width: 300, height: 40 };
  const tablePanelSize = { width: 220, height: 36 };

  it('anchors the text bubble above and the table panel below when there is room above', () => {
    const { text, table: panel } = positionTablePanels(table, textSize, tablePanelSize, VIEWPORT, GAP);
    expect(text.top).toBe(table.top - textSize.height - GAP);
    expect(panel.top).toBe(table.bottom + GAP);
    // Both horizontally centred on the table.
    expect(text.left).toBeCloseTo(table.left + table.width / 2 - textSize.width / 2);
    expect(panel.left).toBeCloseTo(table.left + table.width / 2 - tablePanelSize.width / 2);
  });

  it('flips the text bubble below and the table panel above when there is no room above', () => {
    const nearTop: Rect = { ...table, top: 10, bottom: 70 };
    const { text, table: panel } = positionTablePanels(nearTop, textSize, tablePanelSize, VIEWPORT, GAP);
    expect(text.top).toBe(nearTop.bottom + GAP);
    expect(panel.top).toBe(nearTop.top - tablePanelSize.height - GAP);
  });

  it('always keeps the two panels on opposite edges of the table', () => {
    for (const t of [table, { ...table, top: 10, bottom: 70 }, { ...table, top: 795, bottom: 799 }]) {
      const { text, table: panel } = positionTablePanels(t, textSize, tablePanelSize, VIEWPORT, GAP);
      const textAbove = text.top + textSize.height <= t.top;
      const panelAbove = panel.top + tablePanelSize.height <= t.top;
      expect(textAbove).not.toBe(panelAbove);
    }
  });

  it('clamps horizontal position to stay within the viewport', () => {
    const nearLeftEdge: Rect = { ...table, left: -50, right: 150, width: 200 };
    const { text, table: panel } = positionTablePanels(nearLeftEdge, textSize, tablePanelSize, VIEWPORT, GAP);
    expect(text.left).toBeGreaterThanOrEqual(GAP);
    expect(panel.left).toBeGreaterThanOrEqual(GAP);

    const nearRightEdge: Rect = { ...table, left: 900, right: 1100, width: 200 };
    const { text: text2, table: panel2 } = positionTablePanels(nearRightEdge, textSize, tablePanelSize, VIEWPORT, GAP);
    expect(text2.left).toBeLessThanOrEqual(VIEWPORT.width - textSize.width - GAP);
    expect(panel2.left).toBeLessThanOrEqual(VIEWPORT.width - tablePanelSize.width - GAP);
  });
});
