import type { ViewportBounds } from './rendering/transition/viewport';

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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
