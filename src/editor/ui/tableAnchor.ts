import type { EditorView } from 'prosemirror-view';

export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high));

// Structural, not `DOMRect`: keeps the positioning math testable without a DOM.
export type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export type PanelSize = { width: number; height: number };
export type Viewport = { width: number; height: number };
export type PanelPosition = { top: number; left: number };

export type PanelChoice = 'none' | 'text' | 'table';

// `inTable` (doc structure) and `foundTableEl` (DOM) transiently disagree after a
// transaction, before the view re-renders; that disagreement must resolve to 'none'.
export function choosePanel(empty: boolean, inTable: boolean, foundTableEl: boolean): PanelChoice {
  if (!empty) return 'text';
  return inTable && foundTableEl ? 'table' : 'none';
}

export function tableElementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos).node;
  const el = dom instanceof Element ? dom : dom.parentElement;
  return el?.closest('table') ?? null;
}

// Clamped into the viewport, overlapping the table if need be: a table taller than
// the viewport would otherwise put the panel off-screen and mouse-unreachable.
export function positionTablePanel(
  table: Rect,
  panelSize: PanelSize,
  viewport: Viewport,
  gap: number,
): PanelPosition {
  const left = clamp(
    table.left + table.width / 2 - panelSize.width / 2,
    gap,
    viewport.width - panelSize.width - gap,
  );

  const fitsBelow = table.bottom + gap + panelSize.height <= viewport.height - gap;
  const preferredTop = fitsBelow ? table.bottom + gap : table.top - panelSize.height - gap;
  const top = clamp(preferredTop, gap, viewport.height - panelSize.height - gap);

  return { top, left };
}
