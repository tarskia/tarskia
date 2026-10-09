import { describe, expect, it } from 'vitest';
import { collectRectBounds } from './focus-viewport';

describe('collectRectBounds', () => {
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
});
