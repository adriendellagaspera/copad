import type { EditorView } from 'prosemirror-view';

/** A `getBoundingClientRect()`-shaped rectangle — kept structural (not a
 *  `DOMRect` import) so the positioning math below is testable with plain
 *  numbers, no DOM required. */
export type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export type PanelSize = { width: number; height: number };
export type Viewport = { width: number; height: number };
export type PanelPosition = { top: number; left: number };

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
 * Positions the two floating panels shown for a bare caret inside a table:
 * the text-formatting bubble and the table-structure panel. They're anchored
 * to *opposite* edges of the table's bounding box — whichever edge has room
 * for the text bubble, the table panel takes the other — so the two can
 * never occupy the same vertical band regardless of either panel's width,
 * without needing to measure/react to the other panel's actual position.
 * Horizontal position is independently centred on the table and clamped to
 * the viewport for each panel.
 */
export function positionTablePanels(
  table: Rect,
  textSize: PanelSize,
  tablePanelSize: PanelSize,
  viewport: Viewport,
  gap: number,
): { text: PanelPosition; table: PanelPosition } {
  const clampLeft = (width: number): number => {
    const centered = table.left + table.width / 2 - width / 2;
    return Math.max(gap, Math.min(centered, viewport.width - width - gap));
  };

  const textAbove = table.top - gap >= textSize.height;

  const text: PanelPosition = textAbove
    ? { top: table.top - textSize.height - gap, left: clampLeft(textSize.width) }
    : { top: table.bottom + gap, left: clampLeft(textSize.width) };

  const tablePanel: PanelPosition = textAbove
    ? { top: table.bottom + gap, left: clampLeft(tablePanelSize.width) }
    : { top: table.top - tablePanelSize.height - gap, left: clampLeft(tablePanelSize.width) };

  return { text, table: tablePanel };
}
