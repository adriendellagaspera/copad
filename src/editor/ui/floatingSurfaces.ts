import { choosePanel, clamp, type PanelPosition, type PanelSize, type Rect, type Viewport } from './tableAnchor.js';

export type PixelGap = number & { readonly _brand: 'PixelGap' };

export const PANEL_GAP = 8 as PixelGap;

// Structural, not `DOMRect`: keeps the placement math testable without a DOM.
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

export type TextSurface = 'hidden' | 'selection' | 'armed-caret';

export type TableSurface = 'hidden' | 'shown';

export type FloatingSurfaces = { text: TextSurface; table: TableSurface };

const NOTHING: FloatingSurfaces = { text: 'hidden', table: 'hidden' };

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

// `obstacle` is the table panel — the one surface that can share the caret's space.
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
