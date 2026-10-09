import { describe, expect, it } from 'vitest';
import { interpolateCameraViewport } from './camera-interpolation';

const canvas = { width: 1200, height: 800 };
const viewport = (x: number, y: number, zoom: number) => ({
  x: canvas.width / 2 - x * zoom,
  y: canvas.height / 2 - y * zoom,
  zoom,
});
describe('camera interpolation', () => {
  it.each([
    [1, 4],
    [4, 1],
    [0.05, 2],
    [2, 0.05],
  ])('moves the centre point steadily from zoom %s to %s', (a, b) => {
    const from = viewport(0, 100, a),
      to = viewport(1500, -600, b);
    let previous = -1;
    for (let step = 0; step <= 100; step++) {
      const progress = step / 100;
      const frame = interpolateCameraViewport({
        from,
        to,
        progress,
        canvas,
        minZoom: 0.05,
        maxZoom: 4,
      });
      const x = (canvas.width / 2 - frame.x) / frame.zoom,
        y = (canvas.height / 2 - frame.y) / frame.zoom;
      expect(x).toBeCloseTo(1500 * progress, 8);
      expect(y).toBeCloseTo(100 - 700 * progress, 8);
      expect(x).toBeGreaterThanOrEqual(previous);
      expect(x).toBeLessThanOrEqual(1500);
      expect(frame.zoom).toBeGreaterThanOrEqual(0.05);
      expect(frame.zoom).toBeLessThanOrEqual(4);
      expect(frame.zoom).toBeCloseTo(a * (b / a) ** progress, 8);
      previous = x;
    }
    expect(
      interpolateCameraViewport({ from, to, progress: 0, canvas, minZoom: 0.05, maxZoom: 4 }),
    ).toEqual(from);
    expect(
      interpolateCameraViewport({ from, to, progress: 1, canvas, minZoom: 0.05, maxZoom: 4 }),
    ).toEqual(to);
  });
  it('clamps zoom during a move even if a target is outside the limits', () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const result = interpolateCameraViewport({
        from: viewport(0, 0, 0.01),
        to: viewport(500, 100, 20),
        progress,
        canvas,
        minZoom: 0.05,
        maxZoom: 2,
      });
      expect(result.zoom).toBeGreaterThanOrEqual(0.05);
      expect(result.zoom).toBeLessThanOrEqual(2);
    }
  });
});
