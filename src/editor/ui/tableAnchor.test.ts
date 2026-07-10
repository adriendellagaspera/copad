// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../schema.js';
import { tableElementAt, positionTablePanel, type Rect } from './tableAnchor.js';

const VIEWPORT = { width: 1000, height: 800 };
const GAP = 8;

function tableDoc(): ReturnType<typeof schema.node> {
  // cellContent is 'block+' (see schema.ts) — cells hold real block content,
  // so each cell's text lives inside a wrapping paragraph.
  const para = (text: string) => schema.node('paragraph', null, schema.text(text));
  const cell = (text: string) => schema.node('table_cell', null, [para(text)]);
  const headerCell = (text: string) => schema.node('table_header', null, [para(text)]);
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

describe('positionTablePanel', () => {
  const table: Rect = { top: 300, left: 400, right: 600, bottom: 360, width: 200, height: 60 };
  const panelSize = { width: 220, height: 36 };

  it('anchors below the table when it fits there', () => {
    const panel = positionTablePanel(table, panelSize, VIEWPORT, GAP);
    expect(panel.top).toBe(table.bottom + GAP);
    expect(panel.left).toBeCloseTo(table.left + table.width / 2 - panelSize.width / 2);
  });

  it('flips above when there is no room below', () => {
    const nearBottom: Rect = { ...table, top: 780, bottom: 799 };
    const panel = positionTablePanel(nearBottom, panelSize, VIEWPORT, GAP);
    expect(panel.top).toBe(nearBottom.top - panelSize.height - GAP);
  });

  it('clamps horizontal position to stay within the viewport', () => {
    const nearLeftEdge: Rect = { ...table, left: -50, right: 150, width: 200 };
    const left = positionTablePanel(nearLeftEdge, panelSize, VIEWPORT, GAP).left;
    expect(left).toBeGreaterThanOrEqual(GAP);

    const nearRightEdge: Rect = { ...table, left: 900, right: 1100, width: 200 };
    const right = positionTablePanel(nearRightEdge, panelSize, VIEWPORT, GAP).left;
    expect(right).toBeLessThanOrEqual(VIEWPORT.width - panelSize.width - GAP);
  });

  it('clamps the top into the viewport for a table taller than the viewport — never off-screen below', () => {
    // A table spanning well past the bottom of the viewport (e.g. scrolled,
    // or simply many rows): naively placing the panel at table.bottom + gap
    // would land it far below the visible area, unreachable by mouse.
    const tallTable: Rect = { top: 100, left: 400, right: 600, bottom: 1200, width: 200, height: 1100 };
    const panel = positionTablePanel(tallTable, panelSize, VIEWPORT, GAP);
    expect(panel.top).toBeGreaterThanOrEqual(GAP);
    expect(panel.top).toBeLessThanOrEqual(VIEWPORT.height - panelSize.height - GAP);
  });

  it('clamps the top into the viewport when the table has scrolled above the top edge — never off-screen above', () => {
    // table.top negative (scrolled past the viewport's top) with a short
    // table: neither "below" (off past the bottom, if bottom is also
    // negative) nor a naive "above" placement should ever escape upward.
    const scrolledPastTop: Rect = { top: -900, left: 400, right: 600, bottom: -840, width: 200, height: 60 };
    const panel = positionTablePanel(scrolledPastTop, panelSize, VIEWPORT, GAP);
    expect(panel.top).toBeGreaterThanOrEqual(GAP);
    expect(panel.top).toBeLessThanOrEqual(VIEWPORT.height - panelSize.height - GAP);
  });
});
