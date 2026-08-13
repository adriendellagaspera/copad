// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../schema.js';
import { tableElementAt, positionTablePanel, choosePanel, type Rect } from './tableAnchor.js';

const VIEWPORT = { width: 1000, height: 800 };
const GAP = 8;

function tableDoc(): ReturnType<typeof schema.node> {
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

/** Position inside `text`'s node, found by content rather than a hardcoded offset. */
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
    const pos = textPos(doc, 'A');
    const table = tableElementAt(view, pos);
    expect(table?.tagName).toBe('TABLE');
    view.destroy();
  });

  it('returns null for a position outside any table', () => {
    const doc = tableDoc();
    const view = mountView(doc);
    const pos = textPos(doc, 'after');
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
    const tallTable: Rect = { top: 100, left: 400, right: 600, bottom: 1200, width: 200, height: 1100 };
    const panel = positionTablePanel(tallTable, panelSize, VIEWPORT, GAP);
    expect(panel.top).toBeGreaterThanOrEqual(GAP);
    expect(panel.top).toBeLessThanOrEqual(VIEWPORT.height - panelSize.height - GAP);
  });

  it('clamps the top into the viewport when the table has scrolled above the top edge — never off-screen above', () => {
    const scrolledPastTop: Rect = { top: -900, left: 400, right: 600, bottom: -840, width: 200, height: 60 };
    const panel = positionTablePanel(scrolledPastTop, panelSize, VIEWPORT, GAP);
    expect(panel.top).toBeGreaterThanOrEqual(GAP);
    expect(panel.top).toBeLessThanOrEqual(VIEWPORT.height - panelSize.height - GAP);
  });
});

describe('choosePanel', () => {
  it('shows the text panel for any real (non-empty) selection, table or not', () => {
    expect(choosePanel(false, false, false)).toBe('text');
    expect(choosePanel(false, true, true)).toBe('text');
  });

  it('shows the table panel for a bare caret inside a table once a <table> element is actually found', () => {
    expect(choosePanel(true, true, true)).toBe('table');
  });

  it('shows nothing for a bare caret outside any table', () => {
    expect(choosePanel(true, false, false)).toBe('none');
  });

  it('shows nothing — never the text panel — for a bare caret isInTable says is in a table but no <table> element was resolved for', () => {
    // isInTable (doc structure) and tableElementAt (DOM) transiently disagree right after a
    // transaction, before the view re-renders.
    expect(choosePanel(true, true, false)).toBe('none');
  });
});
