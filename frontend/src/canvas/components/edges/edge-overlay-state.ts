import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
  CanvasOverlayOccluder,
} from '../../rendering/presentation/presentation';
import {
  collapseNestedOccluders,
  expandOccluderRect,
  flattenOccluders,
  splitOccludersByNodeIds,
} from './occluder-geometry';

export interface ResolvedOverlayEdgeView extends CanvasOverlayEdgeView {
  blockerOccluders: CanvasOverlayOccluder[];
}

export interface EdgeOverlayRenderState {
  shellOccluders: CanvasOverlayOccluder[];
  contentOccluders: CanvasOverlayOccluder[];
  overlayWorldBounds: CanvasOverlayOccluder;
  edges: ResolvedOverlayEdgeView[];
}

const DEFAULT_OVERLAY_WORLD_BOUNDS: CanvasOverlayOccluder = {
  x: -2048,
  y: -2048,
  width: 4096,
  height: 4096,
};

export const resolveEdgeOverlayRenderState = (params: {
  edges: CanvasOverlayEdgeView[];
  nodes: CanvasNodeView[];
}): EdgeOverlayRenderState => {
  const { edges, nodes } = params;
  const occluderNodes = nodes.map((node) => ({
    id: node.id,
    rect: node.rect,
    zIndex: node.zIndex,
    focusShell: node.style.focusShell,
  }));

  const contentOccluders: CanvasOverlayOccluder[] = nodes.flatMap((node) => {
    const contentScale = node.kind === 'entity' ? node.contentScale : 1;
    return (node.contentOccluders ?? []).map((occluder) => ({
      x: node.rect.x + occluder.x * contentScale,
      y: node.rect.y + occluder.y * contentScale,
      width: occluder.width * contentScale,
      height: occluder.height * contentScale,
    }));
  });

  const shellOccluders = collapseNestedOccluders(
    occluderNodes
      .filter((node) => !node.focusShell && node.rect.width > 0 && node.rect.height > 0)
      .map((node) =>
        expandOccluderRect({
          x: node.rect.x,
          y: node.rect.y,
          width: node.rect.width,
          height: node.rect.height,
          ...(typeof node.zIndex === 'number' ? { zIndex: node.zIndex } : {}),
        }),
      ),
  );

  const points = [
    ...shellOccluders.flatMap((rect) => [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    ]),
    ...edges.flatMap((edge) => [
      edge.geometry.sourcePoint,
      edge.geometry.control1,
      edge.geometry.control2,
      edge.geometry.targetPoint,
    ]),
  ];
  const overlayWorldBounds =
    points.length === 0
      ? DEFAULT_OVERLAY_WORLD_BOUNDS
      : (() => {
          const minX = Math.min(...points.map((point) => point.x));
          const minY = Math.min(...points.map((point) => point.y));
          const maxX = Math.max(...points.map((point) => point.x));
          const maxY = Math.max(...points.map((point) => point.y));
          const padding = 128;
          return {
            x: minX - padding,
            y: minY - padding,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
          } satisfies CanvasOverlayOccluder;
        })();

  const resolvedEdges = edges.map((edge) => {
    const { ghostOccluders } = splitOccludersByNodeIds({
      nodes: occluderNodes,
      solidOverNodeIds: edge.solidOverNodeIds,
      excludedNodeIds: [edge.sourceId, edge.targetId],
    });
    return {
      ...edge,
      blockerOccluders: flattenOccluders([
        ...ghostOccluders.map((rect) => expandOccluderRect(rect)),
        ...contentOccluders,
      ]),
    } satisfies ResolvedOverlayEdgeView;
  });

  return {
    shellOccluders,
    contentOccluders,
    overlayWorldBounds,
    edges: resolvedEdges,
  };
};
