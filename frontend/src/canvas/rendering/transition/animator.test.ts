import { describe, expect, it } from 'vitest';
import { computeZoomAnimation } from './animator';

describe('computeZoomAnimation', () => {
  it('interpolates positions and fades in', () => {
    const sequence = {
      basePositions: { A: { x: 0, y: 0 } },
      targetPositions: { A: { x: 100, y: 200 } },
      nodeTimings: new Map([
        [
          'A',
          {
            moveX: { start: 0, end: 1 },
            moveY: { start: 0, end: 1 },
            fade: { start: 0, end: 1 },
            fadeMode: 'in' as const,
          },
        ],
      ]),
      childFadeByParent: new Map([['A', { window: { start: 0, end: 1 }, mode: 'in' as const }]]),
    };

    const result = computeZoomAnimation({ progress: 0.5, plan: sequence });
    expect(result.positions.A).toEqual({ x: 50, y: 100 });
    expect(result.nodeVisibility.get('A')).toBeCloseTo(0.5, 3);
    expect(result.childVisibilityByParent.get('A')).toBeCloseTo(0.5, 3);
  });

  it('fades out when fadeMode is out', () => {
    const sequence = {
      basePositions: { A: { x: 0, y: 0 } },
      targetPositions: { A: { x: 0, y: 0 } },
      nodeTimings: new Map([
        [
          'A',
          {
            fade: { start: 0, end: 1 },
            fadeMode: 'out' as const,
          },
        ],
      ]),
      childFadeByParent: new Map(),
    };

    const result = computeZoomAnimation({ progress: 0.25, plan: sequence });
    expect(result.nodeVisibility.get('A')).toBeCloseTo(0.75, 3);
  });

  it('keeps positions fixed before move windows start', () => {
    const sequence = {
      basePositions: { A: { x: 10, y: 20 } },
      targetPositions: { A: { x: 110, y: 220 } },
      nodeTimings: new Map([
        [
          'A',
          {
            moveX: { start: 0.5, end: 1 },
            moveY: { start: 0.5, end: 1 },
          },
        ],
      ]),
      childFadeByParent: new Map(),
    };

    const result = computeZoomAnimation({ progress: 0.25, plan: sequence });
    expect(result.positions.A).toEqual({ x: 10, y: 20 });
  });

  it('falls back to global progress when move timings are missing', () => {
    const sequence = {
      basePositions: { A: { x: 0, y: 0 } },
      targetPositions: { A: { x: 100, y: 200 } },
      nodeTimings: new Map(),
      childFadeByParent: new Map(),
    };

    expect(computeZoomAnimation({ progress: 0.5, plan: sequence }).positions.A).toEqual({
      x: 50,
      y: 100,
    });
    expect(computeZoomAnimation({ progress: 1, plan: sequence }).positions.A).toEqual({
      x: 100,
      y: 200,
    });
  });
});
