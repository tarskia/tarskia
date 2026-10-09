import { describe, expect, it } from 'vitest';
import { buildStructuralCameraAdvisory } from '../canvas/rendering/transition/camera';
import { collectSubtreeIds } from '../canvas/rendering/transition/viewport';
import { computeViewportForBoundsInVisibleCanvas } from '../canvas/viewport-visibility';
import { loadGallery, planGalleryTransition } from '../test/curated-rendering';
import { interpolateCameraViewport } from './camera-interpolation';
import { buildMotionPlanFromChoreographyRequest } from './useDiagramMotionManager';

const canvas = { width: 1440, height: 840 },
  minZoom = 0.05,
  maxZoom = 2;
describe('expansion camera on the real gallery', () => {
  it.each([
    ['n8n.yaml', 'worker-service'],
    ['supabase.yaml', 'edge-function-plane'],
  ])('%s %s never zooms in from the opening view', (file, rootId) => {
    const gallery = loadGallery(file);
    const initial = gallery.render();
    const expandedIds = Object.entries(initial.doc.view?.nodesById ?? {})
      .filter(([, flags]) => flags.expanded)
      .map(([id]) => id);
    const expanded = gallery.render([...expandedIds, rootId]);
    const nodes = initial.presentation.nodes;
    const x = Math.min(...nodes.map((n) => n.rect.x)),
      y = Math.min(...nodes.map((n) => n.rect.y));
    const bounds = {
      x,
      y,
      width: Math.max(...nodes.map((n) => n.rect.x + n.rect.width)) - x,
      height: Math.max(...nodes.map((n) => n.rect.y + n.rect.height)) - y,
    };
    const currentViewport = computeViewportForBoundsInVisibleCanvas({
      bounds,
      canvas,
      minZoom,
      maxZoom,
      padding: 0.3,
    });
    const endPointOfInterestNodeIds = [...collectSubtreeIds(expanded.scene.tree, rootId)];
    const plan = planGalleryTransition(initial, expanded, 'in');
    const motion = buildMotionPlanFromChoreographyRequest({
      request: {
        direction: 'in',
        focus: { kind: 'single', rootId },
        startLayout: initial.scene,
        endLayout: expanded.scene,
        startSnapshot: initial.presentation,
        endSnapshot: expanded.presentation,
        currentViewport,
        endPointOfInterestNodeIds,
        collectSubtreeIds,
        planningAdvisory: plan.planningAdvisory,
      },
      canvasSize: canvas,
      minZoom,
      maxZoom,
    });
    const target = expanded.scene.tree.byId.get(rootId)!;
    const fits =
      target.size.width * currentViewport.zoom <= canvas.width - 80 &&
      target.size.height * currentViewport.zoom <= canvas.height - 80;
    for (const segment of motion.segments) {
      if (!segment.camera) continue;
      expect(segment.camera.to.zoom).toBeLessThanOrEqual(currentViewport.zoom);
      if (fits) expect(segment.camera.to.zoom).toBe(currentViewport.zoom);
      for (let i = 0; i <= 20; i++)
        expect(
          interpolateCameraViewport({
            from: segment.camera.from ?? currentViewport,
            to: segment.camera.to,
            progress: i / 20,
            canvas,
            minZoom,
            maxZoom,
          }).zoom,
        ).toBeLessThanOrEqual(currentViewport.zoom + 1e-12);
    }
    const advisory = buildStructuralCameraAdvisory({
      direction: 'in',
      focus: { kind: 'single', rootId },
      startLayout: initial.scene,
      endLayout: expanded.scene,
      currentViewport,
      canvasSize: canvas,
      endPointOfInterestNodeIds,
      collectSubtreeIds,
      padding: 40,
      minZoom,
      maxZoom,
    });
    expect(advisory.epilogue).toBeUndefined();
    if (fits) expect((advisory.prelude ?? currentViewport).zoom).toBe(currentViewport.zoom);
  });
});
