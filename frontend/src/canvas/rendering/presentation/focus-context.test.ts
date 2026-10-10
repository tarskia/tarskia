import { applyDiagramViewOperation, compileView } from '@tarskia/diagram-semantics';
import { expect, it } from 'vitest';
import { loadGallery } from '../../../test/curated-rendering';
import { canFocusLayoutNode } from '../../../viewer-core/focus-view';
import { buildLayoutResult } from '../layout/layout-pipeline';
import { resolveStructuralCamera } from '../transition/camera';
import { buildTransitionFrameState, resolveAnimationFrame } from '../transition/overlay';
import { buildEdgeVisuals } from '../visual/edge-visuals';
import { rectanglesIntersect } from './edge-routing';
import { buildStaticCanvasPresentation } from './presentation';

it('renders all 20 Chatwoot crossing relations, including frame attachments and camera bounds', () => {
  const gallery = loadGallery('chatwoot.yaml');
  const initial = gallery.render([]);
  const focused = gallery.render([], 'rails-control-plane');
  const { nodes, overlayEdges } = focused.presentation;
  const frame = nodes.find((node) => node.content.focusBoundary)!;
  const boxes = nodes.filter((node) => node.content.externalContext);
  expect(frame.id).toBe('rails-control-plane');
  const crossingEdges = focused.scene.edges.filter((edge) => edge.external);
  const ids = crossingEdges.flatMap((edge) => edge.relationIds ?? [edge.relationId]);
  expect(ids).toHaveLength(20);
  expect(boxes.map((box) => box.id).sort()).toEqual(
    [...new Set(crossingEdges.map((edge) => edge.external!.displayId))].sort(),
  );
  for (const id of ids)
    expect(overlayEdges.some((edge) => edge.relationIds?.includes(id))).toBe(true);
  expect(
    overlayEdges.some((edge) => edge.sourceId === frame.id || edge.targetId === frame.id),
  ).toBe(true);
  for (const box of boxes) {
    const directions = focused.scene
      .focusContext!.edges.filter((edge) => edge.external?.displayId === box.id)
      .flatMap((edge) => buildEdgeVisuals({ schema: gallery.graph.schema, edges: [edge] }));
    const sent = directions.filter((edge) => edge.sourceId === box.id).length;
    const received = directions.length - sent;
    expect(box.rect.x < frame.rect.x).toBe(sent >= received);
    expect(rectanglesIntersect(box.rect, frame.rect)).toBe(false);
    expect(box.controls.showZoomControls).toBe(false);
    expect(gallery.graph.entityIndex.byId.has(box.id)).toBe(true);
    expect(
      canFocusLayoutNode({ sceneTree: focused.scene.tree, index: gallery.graph, entityId: box.id }),
    ).toBe(true);
    for (const other of boxes)
      if (box !== other) expect(rectanglesIntersect(box.rect, other.rect)).toBe(false);
  }
  const camera = resolveStructuralCamera({
    endSnapshot: focused.presentation,
    endLayout: focused.scene,
    focus: null,
    startSnapshot: initial.presentation,
    currentViewport: { x: 0, y: 0, zoom: 1 },
    endPointOfInterestNodeIds: [],
    canvasSize: { width: 1200, height: 800 },
    minZoom: 0.001,
    maxZoom: 2,
  })!;
  for (const node of [...boxes, frame]) {
    expect(node.rect.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(0);
    expect(node.rect.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(0);
    expect((node.rect.x + node.rect.width) * camera.zoom + camera.x).toBeLessThanOrEqual(1200);
    expect((node.rect.y + node.rect.height) * camera.zoom + camera.y).toBeLessThanOrEqual(800);
  }
  const transition = buildTransitionFrameState({
    id: 1,
    startedAt: 0,
    duration: 1000,
    fromPresentation: initial.presentation,
    toPresentation: focused.presentation,
  });
  const moving = resolveAnimationFrame(transition, 500);
  expect(
    moving.nodes.every(
      (node) => !node.view.content.externalContext && !node.view.content.focusBoundary,
    ),
  ).toBe(true);
  expect(moving.edges.every((edge) => !ids.some((id) => edge.relationIds?.includes(id)))).toBe(
    true,
  );
  expect(
    initial.presentation.nodes.every(
      (node) => !node.content.externalContext && !node.content.focusBoundary,
    ),
  ).toBe(true);
});

it('highlights external context and the scope boundary without changing focused geometry', () => {
  const gallery = loadGallery('chatwoot.yaml');
  const focused = gallery.render([], 'rails-control-plane');
  const frame = focused.presentation.nodes.find((node) => node.content.focusBoundary)!;
  const external = focused.presentation.nodes.find((node) => node.content.externalContext)!;
  let view = focused.doc.view;
  for (const entityId of [frame.id, external.id]) {
    view = applyDiagramViewOperation(gallery.graph.tree, view, {
      kind: 'toggle-highlight',
      entityId,
    });
  }
  const scene = buildLayoutResult({
    graph: gallery.graph,
    viewState: compileView(gallery.graph, view),
  });
  const highlighted = buildStaticCanvasPresentation({ scene });
  expect(
    highlighted.nodes
      .filter((node) => node.content.highlighted)
      .map((node) => node.id)
      .sort(),
  ).toEqual([frame.id, external.id].sort());
  expect(highlighted.nodes.map(({ id, rect, opacity }) => ({ id, rect, opacity }))).toEqual(
    focused.presentation.nodes.map(({ id, rect, opacity }) => ({ id, rect, opacity })),
  );
  expect(highlighted.overlayEdges).toEqual(focused.presentation.overlayEdges);
});
