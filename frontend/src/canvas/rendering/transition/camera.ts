import type { ViewportState } from '@tarskia/diagram-semantics';
import type { StructuralChoreographyRequest } from '../../../diagram/motion-types';
import {
  computeViewportForBoundsInVisibleCanvas,
  computeViewportToKeepRectVisible,
} from '../../viewport-visibility';
import { DEFAULT_VIEWPORT_FIT_PADDING } from './animation-constants';

export const READABLE_MIN_ZOOM = 0.35;

export function resolveStructuralCamera({
  endSnapshot,
  endLayout,
  focus,
  direction,
  currentViewport,
  canvasSize,
  endPointOfInterestNodeIds,
  minZoom,
  maxZoom,
}: StructuralChoreographyRequest & {
  canvasSize: { width: number; height: number } | null;
  minZoom: number;
  maxZoom: number;
}): ViewportState | null {
  if (!canvasSize) return null;
  // Focus changes and global operations fit the scene. A local collapse that reaches the
  // top-level single-child chain has the same scene framing as Collapse all.
  let wholeScene = !focus || focus.kind === 'global';
  if (direction === 'out' && focus && focus.kind !== 'global') {
    let node = endLayout.tree.byId.get(focus.rootId);
    while (node?.parentId) {
      if (node.parentId === endLayout.tree.rootId) {
        wholeScene = true;
        break;
      }
      const parent = endLayout.tree.byId.get(node.parentId);
      if (parent?.children.length !== 1) break;
      node = parent;
    }
  }
  const ids = new Set(endPointOfInterestNodeIds);
  const nodes = endSnapshot.nodes.filter(
    (node) => !node.content?.focusShell && node.opacity > 0.001 && (wholeScene || ids.has(node.id)),
  );
  if (!nodes.length) return null;
  const x = Math.min(...nodes.map((node) => node.rect.x));
  const y = Math.min(...nodes.map((node) => node.rect.y));
  const bounds = {
    x,
    y,
    width: Math.max(...nodes.map((node) => node.rect.x + node.rect.width)) - x,
    height: Math.max(...nodes.map((node) => node.rect.y + node.rect.height)) - y,
  };
  const fit = computeViewportForBoundsInVisibleCanvas({
    bounds,
    canvas: canvasSize,
    minZoom,
    maxZoom,
    padding: DEFAULT_VIEWPORT_FIT_PADDING,
  });
  if (direction === 'in' && focus?.kind === 'global') {
    const zoom = Math.min(currentViewport.zoom, Math.max(fit.zoom, READABLE_MIN_ZOOM));
    if (zoom === fit.zoom) return fit;
    const centre = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    return {
      x: centre.x - ((centre.x - currentViewport.x) / currentViewport.zoom) * zoom,
      y: centre.y - ((centre.y - currentViewport.y) / currentViewport.zoom) * zoom,
      zoom,
    };
  }
  if (!focus || (direction === 'out' && wholeScene)) return fit;
  const visible = computeViewportToKeepRectVisible({
    viewport: currentViewport,
    canvas: canvasSize,
    rect: bounds,
    padding: 40,
  });
  if (direction === 'out') return visible ? fit : null;
  const fits =
    bounds.width * currentViewport.zoom <= canvasSize.width - 80 &&
    bounds.height * currentViewport.zoom <= canvasSize.height - 80;
  return fits ? visible : { ...fit, zoom: Math.min(fit.zoom, currentViewport.zoom) };
}
