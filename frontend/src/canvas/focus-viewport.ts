import type { ViewportBounds, ViewportSpec } from './rendering/transition/viewport';

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface FocusViewportPolicy {
  bounds: ViewportBounds;
  fittedViewport: ViewportSpec;
  minZoom: number;
  overscrollPx: number;
  frame: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  lockAtMinZoom: boolean;
}

const DEFAULT_FOCUS_OVERSCROLL_PX = 96;
const EPSILON = 0.001;

export function collectRectBounds(rects: Rect[]): ViewportBounds | null {
  if (rects.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { minX, minY, maxX, maxY };
}

export function computeFocusViewportPolicy(params: {
  rects: Rect[];
  canvas: { width: number; height: number };
  frame: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  minZoom: number;
  maxZoom: number;
  overscrollPx?: number;
}): FocusViewportPolicy | null {
  const bounds = collectRectBounds(params.rects);
  if (!bounds) {
    return null;
  }
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const frameWidth = Math.max(1, params.frame.right - params.frame.left);
  const frameHeight = Math.max(1, params.frame.bottom - params.frame.top);
  const zoomX = frameWidth / width;
  const zoomY = frameHeight / height;
  const fittedZoom = Math.max(params.minZoom, Math.min(params.maxZoom, Math.min(zoomX, zoomY)));
  const fittedViewport = {
    x: params.frame.left - bounds.minX * fittedZoom + (frameWidth - width * fittedZoom) / 2,
    y: params.frame.top - bounds.minY * fittedZoom + (frameHeight - height * fittedZoom) / 2,
    zoom: fittedZoom,
  };
  return {
    bounds,
    fittedViewport,
    minZoom: Math.max(params.minZoom, fittedViewport.zoom),
    overscrollPx: params.overscrollPx ?? DEFAULT_FOCUS_OVERSCROLL_PX,
    frame: params.frame,
    lockAtMinZoom: true,
  };
}

export function clampViewportToFocusPolicy(params: {
  viewport: ViewportSpec;
  canvas: { width: number; height: number };
  policy: FocusViewportPolicy;
}): ViewportSpec | null {
  const { viewport, policy } = params;
  const zoom = Math.max(viewport.zoom, policy.minZoom);
  const locked = policy.lockAtMinZoom && zoom <= policy.minZoom + EPSILON;
  const overscrollPx = locked ? 0 : policy.overscrollPx;
  const minViewportX = policy.frame.right + overscrollPx - policy.bounds.maxX * zoom;
  const maxViewportX = policy.frame.left - overscrollPx - policy.bounds.minX * zoom;
  const minViewportY = policy.frame.bottom + overscrollPx - policy.bounds.maxY * zoom;
  const maxViewportY = policy.frame.top - overscrollPx - policy.bounds.minY * zoom;
  const clampAxis = (value: number, min: number, max: number) => {
    if (min > max) {
      return (min + max) / 2;
    }
    return Math.max(min, Math.min(max, value));
  };
  const nextViewport = {
    x: clampAxis(viewport.x, minViewportX, maxViewportX),
    y: clampAxis(viewport.y, minViewportY, maxViewportY),
    zoom,
  };
  if (
    Math.abs(nextViewport.x - viewport.x) < EPSILON &&
    Math.abs(nextViewport.y - viewport.y) < EPSILON &&
    Math.abs(nextViewport.zoom - viewport.zoom) < EPSILON
  ) {
    return null;
  }
  return nextViewport;
}
