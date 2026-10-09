import { expect, test } from 'vitest';
import { loadGallery, planGalleryTransition } from '../../../test/curated-rendering';
import { captureTransitionFrameSnapshot, resolveAnimationFrame } from '../transition/overlay';
import { routeCanvasEdges } from './edge-routing';
import { buildBezierEdgeGeometry } from './geometry';

test('n8n has one worker/queue line, independent primary IDs and no shared label positions', () => {
  const gallery = loadGallery('n8n.yaml');
  const rendered = gallery.render();
  const { presentation } = rendered;
  const pair = presentation.overlayEdges.filter(
    (edge) => [edge.sourceId, edge.targetId].sort().join('|') === 'worker-service|workflow-queue',
  );
  expect(pair).toHaveLength(1);
  expect(pair[0].directionalLabels).toHaveLength(2);
  expect(new Set(pair[0].directionalLabels?.map((label) => label.label))).toEqual(
    new Set(['pub', 'sub']),
  );
  expect(new Set(pair[0].directionalLabels?.map((label) => label.relationId)).size).toBe(2);
  expect(pair[0].relationIds).toEqual(
    expect.arrayContaining(pair[0].directionalLabels!.map((label) => label.relationId)),
  );
  const first = pair[0].directionalLabels![0];
  const source = presentation.nodes.find((n) => n.id === first.sourceId)!;
  const target = presentation.nodes.find((n) => n.id === first.targetId)!;
  expect(source.rect.x + source.rect.width / 2).toBeLessThan(target.rect.x + target.rect.width / 2);
  expect(
    new Set(presentation.overlayEdges.map((edge) => `${edge.labelAnchor.x},${edge.labelAnchor.y}`))
      .size,
  ).toBe(presentation.overlayEdges.length);
  const { overlay } = planGalleryTransition(rendered, rendered);
  const frame = resolveAnimationFrame(overlay, 1000);
  const snapshot = captureTransitionFrameSnapshot({ state: overlay, frame });
  const captured = snapshot.overlayEdges.find((edge) => edge.id === pair[0].id)!;
  expect(captured.directionalLabels).toEqual(pair[0].directionalLabels);
  expect(captured.relationIds).toEqual(pair[0].relationIds);
  expect(captured.label).toBe(pair[0].label);
});

test.each([
  { x: 300, y: 0 },
  { x: 0, y: 300 },
])('orders directions left-to-right or top-to-bottom for %o', (target) => {
  const nodes = [
    { id: 'a', kind: 'entity' as const, rect: { x: 0, y: 0, width: 100, height: 50 } },
    { id: 'b', kind: 'entity' as const, rect: { ...target, width: 100, height: 50 } },
  ];
  const geometry = buildBezierEdgeGeometry({
    sourceRect: nodes[1].rect,
    targetRect: nodes[0].rect,
  });
  const [edge] = routeCanvasEdges(nodes, [
    {
      id: 'e',
      sourceId: 'b',
      targetId: 'a',
      label: 'back / ahead',
      geometry,
      directionalLabels: [
        { sourceId: 'b', targetId: 'a', relationId: 'back', label: 'back' },
        { sourceId: 'a', targetId: 'b', relationId: 'ahead', label: 'ahead' },
      ],
    },
  ]);
  expect(edge.label).toBe('ahead / back');
  expect(edge.directionalLabels.map((label) => label.relationId)).toEqual(['ahead', 'back']);
});
