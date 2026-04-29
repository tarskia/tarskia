import { describe, expect, it } from 'vitest';
import {
  clampViewportToFocusPolicy,
  collectRectBounds,
  computeFocusViewportPolicy,
} from './focus-viewport';

describe('focus viewport policy', () => {
  it('collects bounds across rendered rects', () => {
    expect(
      collectRectBounds([
        { x: 40, y: 60, width: 120, height: 80 },
        { x: 260, y: 140, width: 160, height: 90 },
      ]),
    ).toEqual({
      minX: 40,
      minY: 60,
      maxX: 420,
      maxY: 230,
    });
  });

  it('derives a focus min zoom from the entered scene bounds', () => {
    const policy = computeFocusViewportPolicy({
      rects: [{ x: 0, y: 0, width: 1200, height: 700 }],
      canvas: { width: 1600, height: 900 },
      frame: { left: 32, top: 32, right: 1568, bottom: 868 },
      minZoom: 0.05,
      maxZoom: 2,
    });

    expect(policy).toBeDefined();
    expect(policy?.minZoom).toBeGreaterThan(1);
    expect(policy?.fittedViewport.zoom).toBe(policy?.minZoom);
  });

  it('snaps the viewport back inside the focused workspace and preserves the zoom floor', () => {
    const policy = computeFocusViewportPolicy({
      rects: [{ x: 0, y: 0, width: 1200, height: 700 }],
      canvas: { width: 1600, height: 900 },
      frame: { left: 32, top: 32, right: 1568, bottom: 868 },
      minZoom: 0.05,
      maxZoom: 2,
    });

    expect(policy).toBeDefined();
    if (!policy) {
      throw new Error('Expected focus viewport policy');
    }
    const next = clampViewportToFocusPolicy({
      viewport: { x: 400, y: 200, zoom: 0.4 },
      canvas: { width: 1600, height: 900 },
      policy,
    });

    expect(next).toBeDefined();
    expect(next?.zoom).toBeCloseTo(policy.minZoom);

    const viewWidth = 1600 / Math.max(next?.zoom ?? 1, 0.001);
    const viewHeight = 900 / Math.max(next?.zoom ?? 1, 0.001);
    const viewMinX = -((next?.x ?? 0) / Math.max(next?.zoom ?? 1, 0.001));
    const viewMinY = -((next?.y ?? 0) / Math.max(next?.zoom ?? 1, 0.001));
    const overscroll = policy.overscrollPx / Math.max(next?.zoom ?? 1, 0.001);

    expect(viewMinX).toBeGreaterThanOrEqual(policy.bounds.minX - overscroll - 0.001);
    expect(viewMinY).toBeGreaterThanOrEqual(policy.bounds.minY - overscroll - 0.001);
    expect(viewMinX + viewWidth).toBeLessThanOrEqual(policy.bounds.maxX + overscroll + 0.001);
    expect(viewMinY + viewHeight).toBeLessThanOrEqual(policy.bounds.maxY + overscroll + 0.001);
  });
});
