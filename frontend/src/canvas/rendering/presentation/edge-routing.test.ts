import { expect, test } from 'vitest';
import {
  edgeLabelRect,
  getRoutingChannelReservations,
  rectanglesIntersect,
  routeCanvasEdges,
} from './edge-routing';
import { buildBezierEdgeGeometry } from './geometry';

const source = {
  id: 'source',
  kind: 'entity' as const,
  rect: { x: 0, y: 0, width: 100, height: 40 },
};
const targets = [0, 1, 2].map((i) => ({
  id: `target${i}`,
  kind: 'entity' as const,
  rect: { x: 500, y: i * 80, width: 100, height: 40 },
}));
const edges = targets.map((target) => ({
  id: target.id,
  sourceId: source.id,
  targetId: target.id,
  label: 'subscribe',
  geometry: buildBezierEdgeGeometry({ sourceRect: source.rect, targetRect: target.rect }),
}));

test('allocates separate 8px channel lanes and collision-free boxes on first legs', () => {
  const routed = routeCanvasEdges([source, ...targets], edges);
  expect(routed[1].geometry.control1.x - routed[0].geometry.control1.x).toBe(8);
  expect(routed[2].geometry.control1.x - routed[1].geometry.control1.x).toBe(8);
  for (const [i, edge] of routed.entries()) {
    const box = edgeLabelRect(edge);
    expect(box.x).toBeGreaterThan(source.rect.x + source.rect.width);
    expect(box.x + box.width).toBeLessThan(edge.geometry.control1.x);
    expect(edge.geometry.labelAnchor.y).toBe(edge.geometry.sourcePoint.y);
    expect(edge.geometry.firstLegLabel).toBe(true);
    for (const other of routed.slice(i + 1))
      expect(rectanglesIntersect(box, edgeLabelRect(other))).toBe(false);
  }
  expect(getRoutingChannelReservations([source, ...targets], edges)[0].space).toBeGreaterThan(
    routed[2].geometry.control1.x - 100,
  );
});

test('routes same-column endpoints along the same outer side', () => {
  const target = { ...targets[0], rect: { ...targets[0].rect, x: 0, y: 100 } };
  const [edge] = routeCanvasEdges([source, target], [edges[0]]);
  expect(edge.geometry.sourceSide).toBe('right');
  expect(edge.geometry.targetSide).toBe('right');
  expect(edge.geometry.control1.x).toBeGreaterThan(100);
});
