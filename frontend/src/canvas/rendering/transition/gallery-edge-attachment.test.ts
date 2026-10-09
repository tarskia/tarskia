import { buildEntityIndex } from '@tarskia/diagram-semantics';
import { expect, it } from 'vitest';
import { galleryFiles, loadGallery, planGalleryTransition } from '../../../test/curated-rendering';
import type { CanvasPoint, CanvasRect } from '../presentation/geometry';
import { resolveTransitionOverlayFrame, type TransitionOverlayEdgeFrame } from './overlay';

const onBoundary = (point: CanvasPoint, rect: CanvasRect) => {
  const insideX = point.x >= rect.x - 1 && point.x <= rect.x + rect.width + 1;
  const insideY = point.y >= rect.y - 1 && point.y <= rect.y + rect.height + 1;
  return (
    insideX &&
    insideY &&
    Math.min(
      Math.abs(point.x - rect.x),
      Math.abs(point.x - rect.x - rect.width),
      Math.abs(point.y - rect.y),
      Math.abs(point.y - rect.y - rect.height),
    ) <= 1
  );
};
const edgeKey = (edge: { relationId: string; sourceId: string; targetId: string }) =>
  `${edge.relationId}:${edge.sourceId}->${edge.targetId}`;

const edgeAppearance = (
  edge: Pick<
    TransitionOverlayEdgeFrame,
    'kind' | 'scopeId' | 'label' | 'state' | 'matched' | 'opacity' | 'geometry' | 'solidOverNodeIds'
  >,
) => ({
  kind: edge.kind,
  scopeId: edge.scopeId,
  label: edge.label,
  state: edge.state,
  matched: edge.matched,
  opacity: edge.opacity,
  geometry: edge.geometry,
  solidOverNodeIds: edge.solidOverNodeIds,
});

it.each(galleryFiles)('$title keeps every single-node toggle edge attached and settles exactly', ({
  file,
}) => {
  const gallery = loadGallery(file);
  const index = buildEntityIndex([...gallery.graph.entities]);
  const expandable = [...index.childrenByParent]
    .filter(([, children]) => children.length)
    .map(([id]) => id);
  const expanded = gallery.render(expandable);
  let sampledEdges = 0;
  for (const id of expandable) {
    const collapsed = gallery.render(expandable.filter((other) => other !== id));
    for (const [from, to, direction] of [
      [collapsed, expanded, 'in'],
      [expanded, collapsed, 'out'],
    ] as const) {
      const { overlay } = planGalleryTransition(from, to, direction);
      for (let step = 0; step <= 20; step++) {
        const frame = resolveTransitionOverlayFrame(overlay, step * 50);
        const rects = new Map(frame.nodes.map((node) => [node.id, node.rect]));
        for (const edge of frame.edges) {
          sampledEdges++;
          expect(
            onBoundary(edge.geometry.sourcePoint, rects.get(edge.sourceId)!),
            `${file} ${id} ${direction} ${step}: source ${edge.id}`,
          ).toBe(true);
          expect(
            onBoundary(edge.geometry.targetPoint, rects.get(edge.targetId)!),
            `${file} ${id} ${direction} ${step}: target ${edge.id}`,
          ).toBe(true);
        }
      }
      const end = resolveTransitionOverlayFrame(overlay, 1000);
      expect(end.edges).toHaveLength(to.presentation.overlayEdges.length);
      const actual = new Map(end.edges.map((edge) => [edgeKey(edge), edgeAppearance(edge)]));
      expect(actual.size).toBe(end.edges.length);
      const expected = new Map(
        to.presentation.overlayEdges.map((edge) => [edgeKey(edge), edgeAppearance(edge)]),
      );
      expect(actual, `${file} ${id} ${direction}: final edge geometry and appearance`).toEqual(
        expected,
      );
      expect(new Map(end.nodes.map((node) => [node.id, node.rect]))).toEqual(
        new Map(to.presentation.nodes.map((node) => [node.id, node.rect])),
      );
    }
  }
  expect(sampledEdges).toBeGreaterThan(0);
}, 60000);
