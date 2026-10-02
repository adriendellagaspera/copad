export type ViewportPx = number & { readonly _brand: 'ViewportPx' };

export interface ViewportInsetGeometry {
  readonly layoutHeight: ViewportPx;
  readonly visualHeight: ViewportPx;
  readonly visualOffsetTop: ViewportPx;
}

export function visualViewportBottomInset({
  layoutHeight,
  visualHeight,
  visualOffsetTop,
}: ViewportInsetGeometry): ViewportPx {
  return Math.max(0, Math.round(layoutHeight - visualHeight - visualOffsetTop)) as ViewportPx;
}
