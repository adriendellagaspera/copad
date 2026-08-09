import { describe, it, expect } from 'vitest';
import {
  chooseSurfaces,
  placeCaretPill,
  placeSelectionBubble,
  PANEL_GAP,
  type CaretRect,
  type SurfaceInput,
} from './floatingSurfaces.js';
import type { Rect } from './tableAnchor.js';

const VIEWPORT = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 40 };

const input = (over: Partial<SurfaceInput> = {}): SurfaceInput => ({
  pointer: 'fine',
  focus: 'editor',
  selection: 'collapsed',
  table: 'outside-table',
  armed: 'none',
  slashMenu: 'closed',
  ...over,
});

const caret = (top: number, height = 20, left = 500): CaretRect => ({
  left,
  right: left + 1,
  top,
  bottom: top + height,
});

describe('chooseSurfaces', () => {
  it('shows nothing on a coarse pointer, whatever the selection', () => {
    expect(chooseSurfaces(input({ pointer: 'coarse', selection: 'ranged' }))).toEqual({
      text: 'hidden',
      table: 'hidden',
    });
    expect(
      chooseSurfaces(input({ pointer: 'coarse', armed: 'some', table: 'table-anchored' })),
    ).toEqual({ text: 'hidden', table: 'hidden' });
  });

  it('shows nothing once focus has left both the editor and the panels', () => {
    expect(chooseSurfaces(input({ focus: 'elsewhere', selection: 'ranged' }))).toEqual({
      text: 'hidden',
      table: 'hidden',
    });
  });

  it('shows the selection bubble for a real selection and never the table panel', () => {
    expect(chooseSurfaces(input({ selection: 'ranged' }))).toEqual({
      text: 'selection',
      table: 'hidden',
    });
    expect(chooseSurfaces(input({ selection: 'ranged', table: 'table-anchored' }))).toEqual({
      text: 'selection',
      table: 'hidden',
    });
  });

  it('keeps the selection bubble up while focus sits in a floating panel', () => {
    expect(chooseSurfaces(input({ selection: 'ranged', focus: 'floating-panel' }))).toEqual({
      text: 'selection',
      table: 'hidden',
    });
  });

  it('shows nothing for a bare caret with no armed marks outside a table', () => {
    expect(chooseSurfaces(input())).toEqual({ text: 'hidden', table: 'hidden' });
  });

  it('shows only the table panel for a bare caret in a table with nothing armed', () => {
    expect(chooseSurfaces(input({ table: 'table-anchored' }))).toEqual({
      text: 'hidden',
      table: 'shown',
    });
  });

  it('shows the armed pill for a collapsed caret with marks armed', () => {
    expect(chooseSurfaces(input({ armed: 'some' }))).toEqual({
      text: 'armed-caret',
      table: 'hidden',
    });
  });

  it('shows the armed pill alongside the table panel inside a cell', () => {
    expect(chooseSurfaces(input({ armed: 'some', table: 'table-anchored' }))).toEqual({
      text: 'armed-caret',
      table: 'shown',
    });
  });

  it('never shows the armed pill while the slash menu owns the caret', () => {
    expect(chooseSurfaces(input({ armed: 'some', slashMenu: 'open' }))).toEqual({
      text: 'hidden',
      table: 'hidden',
    });
  });

  it('drops the armed pill once focus moves into a panel, keeping the table panel', () => {
    expect(
      chooseSurfaces(input({ armed: 'some', table: 'table-anchored', focus: 'floating-panel' })),
    ).toEqual({ text: 'hidden', table: 'shown' });
  });

  it('shows nothing for a caret whose table element could not be resolved', () => {
    expect(chooseSurfaces(input({ table: 'table-unresolved' }))).toEqual({
      text: 'hidden',
      table: 'hidden',
    });
  });
});

describe('placeSelectionBubble', () => {
  it('centres above the selection when there is room', () => {
    const start = caret(300, 20, 400);
    const end = caret(300, 20, 600);
    expect(placeSelectionBubble(start, end, SIZE, VIEWPORT, PANEL_GAP)).toEqual({
      shown: true,
      at: { top: 300 - 40 - 8, left: 500 - 100 },
    });
  });

  it('flips below when the selection is against the top edge', () => {
    const start = caret(4, 20, 400);
    const end = caret(4, 20, 400);
    const placed = placeSelectionBubble(start, end, SIZE, VIEWPORT, PANEL_GAP);
    expect(placed).toEqual({ shown: true, at: { top: 24 + 8, left: 400 - 100 } });
  });

  it('clamps horizontally at both viewport edges', () => {
    const left = placeSelectionBubble(caret(300, 20, 0), caret(300, 20, 0), SIZE, VIEWPORT, PANEL_GAP);
    expect(left).toEqual({ shown: true, at: { top: 252, left: 8 } });
    const right = placeSelectionBubble(
      caret(300, 20, 1000),
      caret(300, 20, 1000),
      SIZE,
      VIEWPORT,
      PANEL_GAP,
    );
    expect(right).toEqual({ shown: true, at: { top: 252, left: 1000 - 200 - 8 } });
  });

  it('hides once the selection has scrolled past either viewport edge', () => {
    expect(
      placeSelectionBubble(caret(-60, 20), caret(-60, 20), SIZE, VIEWPORT, PANEL_GAP),
    ).toEqual({ shown: false });
    expect(
      placeSelectionBubble(caret(900, 20), caret(900, 20), SIZE, VIEWPORT, PANEL_GAP),
    ).toEqual({ shown: false });
  });
});

describe('placeCaretPill', () => {
  const PILL = { width: 60, height: 22 };

  it('sits above the caret when there is room', () => {
    expect(placeCaretPill(caret(300), PILL, VIEWPORT, PANEL_GAP, null)).toEqual({
      shown: true,
      at: { top: 300 - 22 - 8, left: 500 - 30 },
    });
  });

  it('flips below when the caret is against the top edge', () => {
    expect(placeCaretPill(caret(2), PILL, VIEWPORT, PANEL_GAP, null)).toEqual({
      shown: true,
      at: { top: 22 + 8, left: 470 },
    });
  });

  it('clamps horizontally at both viewport edges', () => {
    expect(placeCaretPill(caret(300, 20, 0), PILL, VIEWPORT, PANEL_GAP, null)).toEqual({
      shown: true,
      at: { top: 270, left: 8 },
    });
    expect(placeCaretPill(caret(300, 20, 1000), PILL, VIEWPORT, PANEL_GAP, null)).toEqual({
      shown: true,
      at: { top: 270, left: 1000 - 60 - 8 },
    });
  });

  it('hides once the caret has scrolled past either viewport edge', () => {
    expect(placeCaretPill(caret(-60), PILL, VIEWPORT, PANEL_GAP, null)).toEqual({ shown: false });
    expect(placeCaretPill(caret(900), PILL, VIEWPORT, PANEL_GAP, null)).toEqual({ shown: false });
  });

  it('flips below the caret when the table panel occupies the space above it', () => {
    const above: Rect = { top: 240, left: 400, right: 700, bottom: 292, width: 300, height: 52 };
    expect(placeCaretPill(caret(300), PILL, VIEWPORT, PANEL_GAP, above)).toEqual({
      shown: true,
      at: { top: 328, left: 470 },
    });
  });

  it('stays above when the table panel sits clear of the caret', () => {
    const below: Rect = { top: 500, left: 400, right: 700, bottom: 552, width: 300, height: 52 };
    expect(placeCaretPill(caret(300), PILL, VIEWPORT, PANEL_GAP, below)).toEqual({
      shown: true,
      at: { top: 270, left: 470 },
    });
  });

  it('ignores a panel that overlaps vertically but not horizontally', () => {
    const aside: Rect = { top: 240, left: 0, right: 100, bottom: 292, width: 100, height: 52 };
    expect(placeCaretPill(caret(300), PILL, VIEWPORT, PANEL_GAP, aside)).toEqual({
      shown: true,
      at: { top: 270, left: 470 },
    });
  });

  it('keeps the pill on screen when neither side is both clear and in view', () => {
    const everywhere: Rect = { top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
    const placed = placeCaretPill(caret(4), PILL, VIEWPORT, PANEL_GAP, everywhere);
    expect(placed).toEqual({ shown: true, at: { top: 32, left: 470 } });
  });

  it('clamps into the viewport when the caret leaves no room on either side', () => {
    const tall = { width: 60, height: 790 };
    const placed = placeCaretPill(caret(400), tall, VIEWPORT, PANEL_GAP, null);
    expect(placed).toEqual({ shown: true, at: { top: 8, left: 470 } });
  });
});
