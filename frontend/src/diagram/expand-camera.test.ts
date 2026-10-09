import { describe, expect, it } from 'vitest';
import { collectSubtreeIds } from '../canvas/rendering/transition/viewport';
import { computeViewportForBoundsInVisibleCanvas } from '../canvas/viewport-visibility';
import { loadGallery } from '../test/curated-rendering';
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
    const motion = buildMotionPlanFromChoreographyRequest({
      request: {
        direction: 'in',
        focus: { kind: 'single', rootId },
        endLayout: expanded.scene,
        startSnapshot: initial.presentation,
        endSnapshot: expanded.presentation,
        currentViewport,
        endPointOfInterestNodeIds,
      },
      canvasSize: canvas,
      minZoom,
      maxZoom,
    });
    const target = expanded.scene.tree.byId.get(rootId)!;
    const fits =
      target.size.width * currentViewport.zoom <= canvas.width - 80 &&
      target.size.height * currentViewport.zoom <= canvas.height - 80;
    if (motion.camera) {
      expect(motion.camera.to.zoom).toBeLessThanOrEqual(currentViewport.zoom);
      if (fits) expect(motion.camera.to.zoom).toBe(currentViewport.zoom);
      for (let i = 0; i <= 20; i++)
        expect(
          interpolateCameraViewport({
            from: motion.camera.from ?? currentViewport,
            to: motion.camera.to,
            progress: i / 20,
            canvas,
            minZoom,
            maxZoom,
          }).zoom,
        ).toBeLessThanOrEqual(currentViewport.zoom + 1e-12);
    }
    if (fits) expect((motion.camera?.to ?? currentViewport).zoom).toBe(currentViewport.zoom);
  });
  it('keeps n8n Expand all readable from its opening view and preserves the centre world point', () => {
    const gallery = loadGallery('n8n.yaml');
    const initial = gallery.render();
    const expanded = gallery.render(gallery.graph.entities.map((entity) => entity.id));
    const rects = initial.presentation.nodes.map((node) => node.rect);
    const x = Math.min(...rects.map((rect) => rect.x)),
      y = Math.min(...rects.map((rect) => rect.y));
    const currentViewport = computeViewportForBoundsInVisibleCanvas({
      bounds: {
        x,
        y,
        width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
        height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
      },
      canvas,
      minZoom,
      maxZoom,
      padding: 0.3,
    });
    const motion = buildMotionPlanFromChoreographyRequest({
      request: {
        direction: 'in',
        focus: { kind: 'global' },
        endLayout: expanded.scene,
        startSnapshot: initial.presentation,
        endSnapshot: expanded.presentation,
        currentViewport,
        endPointOfInterestNodeIds: [...expanded.scene.visibleIds],
      },
      canvasSize: canvas,
      minZoom,
      maxZoom,
    });
    const target = motion.camera?.to ?? currentViewport;
    expect(target.zoom).toBe(0.35);
    expect(target.zoom).toBeLessThanOrEqual(currentViewport.zoom);
    expect((canvas.width / 2 - target.x) / target.zoom).toBeCloseTo(
      (canvas.width / 2 - currentViewport.x) / currentViewport.zoom,
      10,
    );
    expect((canvas.height / 2 - target.y) / target.zoom).toBeCloseTo(
      (canvas.height / 2 - currentViewport.y) / currentViewport.zoom,
      10,
    );
  });
});
