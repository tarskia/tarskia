import { expect, test } from 'vitest';
import { assignDistributedEdgeAnchors } from './edge-anchors';

test('distributes incoming and outgoing anchors together in other-endpoint order', () => {
  const center = { x: 0, y: 0, width: 100, height: 120 };
  const edges = [
    {
      id: 'lower',
      sourceId: 'center',
      targetId: 'low',
      sourceRect: center,
      targetRect: { x: 200, y: 200, width: 100, height: 40 },
    },
    {
      id: 'upper',
      sourceId: 'center',
      targetId: 'high',
      sourceRect: center,
      targetRect: { x: 200, y: -100, width: 100, height: 40 },
    },
    {
      id: 'incoming',
      sourceId: 'middle',
      targetId: 'center',
      sourceRect: { x: 200, y: 40, width: 100, height: 40 },
      targetRect: center,
    },
  ];
  const result = assignDistributedEdgeAnchors(edges);
  expect(result.get('upper')?.sourcePoint).toEqual({ x: 100, y: 30 });
  expect(result.get('incoming')?.targetPoint).toEqual({ x: 100, y: 60 });
  expect(result.get('lower')?.sourcePoint).toEqual({ x: 100, y: 90 });
  expect(assignDistributedEdgeAnchors([...edges].reverse())).toEqual(result);
});

test('uses explicit sides for same-column routes', () => {
  const result = assignDistributedEdgeAnchors([
    {
      id: 'e',
      sourceId: 'a',
      targetId: 'b',
      sourceRect: { x: 0, y: 0, width: 100, height: 40 },
      targetRect: { x: 0, y: 100, width: 100, height: 40 },
      sourceSide: 'right',
      targetSide: 'right',
    },
  ]);
  expect(result.get('e')?.sourcePoint).toEqual({ x: 100, y: 20 });
  expect(result.get('e')?.targetPoint).toEqual({ x: 100, y: 120 });
});
