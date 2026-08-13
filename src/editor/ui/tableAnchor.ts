import type { EditorView } from 'prosemirror-view';

/** Confines `value` to `[low, high]` — the one clamp every floating-panel
 *  positioning function (this module and `floatingSurfaces.ts`) shares. */
export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high));

/** A `getBoundingClientRect()`-shaped rectangle — kept structural (not a
 *  `DOMRect` import) so the positioning math below is testable with plain
 *  numbers, no DOM required. */
export type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export type PanelSize = { width: number; height: number };
export type Viewport = { width: number; height: number };
export type PanelPosition = { top: number; left: number };

export type PanelChoice = 'none' | 'text' | 'table';

/**
 * Which floating panel (if any) should show — kept as a pure decision,
 * separate from DOM measurement, so the two panels' mutual exclusivity is
 * provable without a live view. A bare caret only shows the table panel when
 * a `<table>` element was actually resolved for it (`foundTableEl`):
 * `isInTable` (doc-structure) and `tableElementAt` (DOM lookup) can
 * transiently disagree — e.g. right after a transaction, before the view has
 * re-rendered — and a bare caret has no selection of its own to fall back to
 * bubbling over, so that disagreement must resolve to `'none'`, never
 * `'text'`.
 */
export function choosePanel(empty: boolean, inTable: boolean, foundTableEl: boolean): PanelChoice {
  if (!empty) return 'text';
  return inTable && foundTableEl ? 'table' : 'none';
}

/** The nearest `<table>` ancestor of a document position, if any — used to
 *  anchor the floating panels to the table itself rather than the caret's
 *  own line when there's no real selection (a bare caret can be on any row,
 *  and a line-anchored panel would jitter as it moves between cells). */
export function tableElementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos).node;
  const el = dom instanceof Element ? dom : dom.parentElement;
  return el?.closest('table') ?? null;
}

/**
 * Positions the table-structure panel shown for a bare caret inside a table
 * — anchored below the table if it fits there, else above. Both axes are
 * clamped into the viewport (`[gap, viewport − panelSize − gap]`): a table
 * taller than the viewport, or scrolled so its edge crosses the viewport
 * boundary, would otherwise place the panel using `table.bottom`/`table.top`
 * verbatim — arbitrarily far off-screen and mouse-unreachable, the exact
 * failure this clamp exists to prevent. The panel may end up overlapping the
 * table itself in that case (there's no "outside" space to put it in), which
 * is the same trade-off spreadsheet apps make for an oversized selection's
 * floating toolbar — better than vanishing off-screen entirely.
 */
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
