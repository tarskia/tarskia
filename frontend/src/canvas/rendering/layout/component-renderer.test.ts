import { describe, expect, it } from 'vitest';
import { renderComponentLayout } from './component-renderer';

describe('renderComponentLayout', () => {
  it('computes required size and positions for a child', () => {
    const result = renderComponentLayout(
      {
        child: { width: 140, height: 60 },
      },
      [],
      {
        padding: 16,
        headerHeight: 40,
      },
    );

    expect(result.positions.child).toBeDefined();
    expect(result.requiredSize.width).toBeGreaterThanOrEqual(140 + 32);
    expect(result.requiredSize.height).toBeGreaterThanOrEqual(60 + 32 + 40);
  });

  it('computes positions without hint overrides', () => {
    const result = renderComponentLayout(
      {
        child: { width: 120, height: 50 },
      },
      [],
      {
        padding: 16,
        headerHeight: 40,
      },
    );

    expect(result.positions.child).toBeDefined();
    expect(Object.keys(result.computedPositions).length).toBeGreaterThan(0);
  });
});
