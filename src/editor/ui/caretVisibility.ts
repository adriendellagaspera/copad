import type { ViewportPx } from '../../ui/viewportInset.js';

export interface CaretOcclusionGeometry {
  readonly caretBottom: ViewportPx;
  readonly occlusionTop: ViewportPx;
  readonly clearance: ViewportPx;
}

export function caretScrollDelta({
  caretBottom,
  occlusionTop,
  clearance,
}: CaretOcclusionGeometry): ViewportPx {
  return Math.max(0, caretBottom + clearance - occlusionTop) as ViewportPx;
}
