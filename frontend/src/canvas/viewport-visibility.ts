import { getViewportForBounds } from './camera';

type ViewportState = {
  x: number;
  y: number;
  zoom: number;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function computeViewportForBoundsInVisibleCanvas(params: {
  bounds: Rect;
  canvas: { width: number; height: number };
  minZoom: number;
  maxZoom: number;
  padding?: number;
}): ViewportState {
  const visibleWidth = Math.max(1, params.canvas.width);
  const viewport = getViewportForBounds(
    params.bounds,
    visibleWidth,
    params.canvas.height,
    params.minZoom,
    params.maxZoom,
    params.padding ?? 0.1,
  );

  return {
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.zoom,
  };
}

export function computeViewportToKeepRectVisible(params: {
  viewport: ViewportState;
  canvas: { width: number; height: number };
  rect: Rect;
  padding?: number;
}): ViewportState | null {
  const { viewport, canvas, rect } = params;
  const padding = params.padding ?? 40;
  const safeLeft = padding;
  const safeTop = padding;
  const safeRight = Math.max(safeLeft, canvas.width - padding);
  const safeBottom = Math.max(safeTop, canvas.height - padding);

  const left = rect.x * viewport.zoom + viewport.x;
  const top = rect.y * viewport.zoom + viewport.y;
  const right = (rect.x + rect.width) * viewport.zoom + viewport.x;
  const bottom = (rect.y + rect.height) * viewport.zoom + viewport.y;

  let nextX = viewport.x;
  let nextY = viewport.y;

  const visibleWidth = safeRight - safeLeft;
  if (right - left > visibleWidth) {
    nextX += (safeLeft + safeRight) / 2 - (left + right) / 2;
  } else if (left < safeLeft) {
    nextX += safeLeft - left;
  } else if (right > safeRight) {
    nextX -= right - safeRight;
  }

  const visibleHeight = safeBottom - safeTop;
  if (bottom - top > visibleHeight) {
    nextY += (safeTop + safeBottom) / 2 - (top + bottom) / 2;
  } else if (top < safeTop) {
    nextY += safeTop - top;
  } else if (bottom > safeBottom) {
    nextY -= bottom - safeBottom;
  }

  if (nextX === viewport.x && nextY === viewport.y) {
    return null;
  }

  return {
    x: nextX,
    y: nextY,
    zoom: viewport.zoom,
  };
}
