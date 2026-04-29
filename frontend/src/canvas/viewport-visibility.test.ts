import { describe, expect, it } from 'vitest';
import {
  computeViewportForBoundsInVisibleCanvas,
  computeViewportToKeepRectVisible,
} from './viewport-visibility';

describe('computeViewportToKeepRectVisible', () => {
  it('returns null when the rect is already safely visible', () => {
    expect(
      computeViewportToKeepRectVisible({
        viewport: { x: 0, y: 0, zoom: 1 },
        canvas: { width: 900, height: 600 },
        rect: { x: 120, y: 120, width: 160, height: 100 },
        padding: 40,
      }),
    ).toBeNull();
  });

  it('pans left when the rect is clipped by the right edge', () => {
    expect(
      computeViewportToKeepRectVisible({
        viewport: { x: 0, y: 0, zoom: 1 },
        canvas: { width: 600, height: 400 },
        rect: { x: 520, y: 120, width: 120, height: 80 },
        padding: 40,
      }),
    ).toEqual({ x: -80, y: 0, zoom: 1 });
  });

  it('treats left occlusion as unavailable space when ensuring a rect is visible', () => {
    expect(
      computeViewportToKeepRectVisible({
        viewport: { x: 0, y: 0, zoom: 1 },
        canvas: { width: 900, height: 600 },
        rect: { x: 120, y: 120, width: 160, height: 100 },
        padding: 40,
        leftOcclusion: 260,
      }),
    ).toEqual({ x: 180, y: 0, zoom: 1 });
  });

  it('centers oversized rects inside the safe frame without changing zoom', () => {
    expect(
      computeViewportToKeepRectVisible({
        viewport: { x: 0, y: 0, zoom: 1.5 },
        canvas: { width: 800, height: 500 },
        rect: { x: 80, y: 40, width: 640, height: 220 },
        padding: 40,
      }),
    ).toEqual({
      x: -200,
      y: 0,
      zoom: 1.5,
    });
  });
});

describe('computeViewportForBoundsInVisibleCanvas', () => {
  it('fits bounds inside the visible canvas frame instead of the occluded full width', () => {
    const viewport = computeViewportForBoundsInVisibleCanvas({
      bounds: { x: 0, y: 0, width: 400, height: 200 },
      canvas: { width: 1000, height: 600 },
      minZoom: 0.5,
      maxZoom: 2,
      padding: 0.2,
      leftOcclusion: 300,
    });

    expect(viewport.zoom).toBeCloseTo(1.4583, 3);
    expect(viewport.x).toBeCloseTo(358.3333, 3);
    expect(viewport.y).toBeCloseTo(154.1667, 3);
  });
});
