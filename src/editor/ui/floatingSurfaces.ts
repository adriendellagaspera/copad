import { choosePanel, clamp, type PanelPosition, type PanelSize, type Rect, type Viewport } from './tableAnchor.js';

/** A distance in CSS pixels — the breathing room between an anchor and a
 *  floating surface. */
export type PixelGap = number & { readonly _brand: 'PixelGap' };

export const PANEL_GAP = 8 as PixelGap;

/** A `coordsAtPos()`-shaped rectangle — kept structural (not a `DOMRect`
 *  import) so the placement math below is testable with plain numbers. */
export type CaretRect = { left: number; right: number; top: number; bottom: number };

export type PointerProfile = 'fine' | 'coarse';
export type EditorFocus = 'editor' | 'floating-panel' | 'elsewhere';
export type SelectionShape = 'collapsed' | 'ranged';
export type TableContext = 'outside-table' | 'table-unresolved' | 'table-anchored';
export type ArmedMarks = 'none' | 'some';
export type SlashMenuState = 'open' | 'closed';

export type CaretInTable = boolean & { readonly _brand: 'CaretInTable' };
export type TableAnchorFound = boolean & { readonly _brand: 'TableAnchorFound' };

export function tableContextOf(
  inTable: CaretInTable,
  anchorFound: TableAnchorFound,
): TableContext {
  if (!inTable) return 'outside-table';
  return anchorFound ? 'table-anchored' : 'table-unresolved';
}

export type SurfaceInput = {
  pointer: PointerProfile;
  focus: EditorFocus;
  selection: SelectionShape;
  table: TableContext;
  armed: ArmedMarks;
  slashMenu: SlashMenuState;
};

/** The caret/selection-anchored formatting surface: at most one of the
 *  interactive bubble over a real selection and the read-only pill naming the
 *  marks a collapsed caret has armed. */
export type TextSurface = 'hidden' | 'selection' | 'armed-caret';

/** The table-structure panel, anchored to the table rather than the caret —
 *  independent of `TextSurface`, since a collapsed caret in a cell can have
 *  marks armed and still need its structure commands. */
export type TableSurface = 'hidden' | 'shown';

export type FloatingSurfaces = { text: TextSurface; table: TableSurface };

const NOTHING: FloatingSurfaces = { text: 'hidden', table: 'hidden' };

/**
 * Which floating surfaces show, as a pure decision separate from DOM
 * measurement — so "the bubble and the pill are mutually exclusive" and "a
 * bare caret never shows the text-formatting bubble" are provable without a
 * live view. The pill defers to the slash menu, which anchors to the same
 * caret and owns that space while open.
 */
export function chooseSurfaces(input: SurfaceInput): FloatingSurfaces {
  if (input.pointer !== 'fine' || input.focus === 'elsewhere') return NOTHING;

  const panel = choosePanel(
    input.selection === 'collapsed',
    input.table !== 'outside-table',
    input.table === 'table-anchored',
  );
  if (panel === 'text') return { text: 'selection', table: 'hidden' };

  const table: TableSurface = panel === 'table' ? 'shown' : 'hidden';
  const pill = input.focus === 'editor' && input.armed === 'some' && input.slashMenu === 'closed';
  return { text: pill ? 'armed-caret' : 'hidden', table };
}

export type Placement = { shown: false } | { shown: true; at: PanelPosition };

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

const boxAt = (top: number, left: number, size: PanelSize): Rect => ({
  top,
  left,
  right: left + size.width,
  bottom: top + size.height,
  width: size.width,
  height: size.height,
});

/**
 * Places the formatting bubble over a real selection: centred on the two
 * endpoints, above them when there is room and below otherwise. Hidden
 * outright once the selection has scrolled past either edge of the viewport,
 * so it never tracks off-screen text over unrelated chrome.
 */
export function placeSelectionBubble(
  start: CaretRect,
  end: CaretRect,
  size: PanelSize,
  viewport: Viewport,
  gap: PixelGap,
): Placement {
  if (end.bottom < 0 || start.top > viewport.height) return { shown: false };
  const left = clamp((start.left + end.left) / 2 - size.width / 2, gap, viewport.width - size.width - gap);
  const above = start.top - size.height - gap;
  const top = above < gap ? end.bottom + gap : above;
  return { shown: true, at: { top, left } };
}

/**
 * Places the armed-marks pill over a collapsed caret. Prefers above, flips
 * below when that would leave the viewport or collide with `obstacle` — the
 * table-structure panel, the one surface that can share the caret's space,
 * since it anchors to the table's own edge and a caret in the first row sits
 * right under it.
 */
export function placeCaretPill(
  caret: CaretRect,
  size: PanelSize,
  viewport: Viewport,
  gap: PixelGap,
  obstacle: Rect | null,
): Placement {
  if (caret.bottom < 0 || caret.top > viewport.height) return { shown: false };
  const left = clamp(caret.left - size.width / 2, gap, viewport.width - size.width - gap);
  const candidates = [caret.top - size.height - gap, caret.bottom + gap];
  const fits = (top: number): boolean => top >= gap && top + size.height <= viewport.height - gap;
  const clear = (top: number): boolean => !obstacle || !intersects(boxAt(top, left, size), obstacle);
  const top =
    candidates.find((t) => fits(t) && clear(t)) ??
    candidates.find(fits) ??
    clamp(candidates[0], gap, viewport.height - size.height - gap);
  return { shown: true, at: { top, left } };
}
