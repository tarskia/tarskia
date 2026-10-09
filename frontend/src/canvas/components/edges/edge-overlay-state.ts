import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
  CanvasOverlayOccluder,
  CanvasRenderSnapshot,
} from '../../rendering/presentation/presentation';
import {
  buildClipPathFromOccluders,
  collapseNestedOccluders,
  expandOccluderRect,
  flattenOccluders,
} from './occluder-geometry';

export interface ResolvedOverlayEdgeView extends CanvasOverlayEdgeView {
  blockerOccluders: CanvasOverlayOccluder[];
  solidClipPath: string;
  blockedClipPath: string;
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

  const expandedNodeOccluders = occluderNodes
    .filter((node) => !node.focusShell && node.rect.width > 0 && node.rect.height > 0)
    .map((node) => ({ id: node.id, rect: expandOccluderRect(node.rect) }));
  const resolvedEdges = edges.map((edge) => {
    const bounds = edgePathSegmentBounds(edge.path);
    const intersectsPath = (rect: CanvasOverlayOccluder) =>
      !bounds ||
      bounds.some(
        (box) =>
          rect.x <= box.x + box.width &&
          rect.x + rect.width >= box.x &&
          rect.y <= box.y + box.height &&
          rect.y + rect.height >= box.y,
      );
    const excluded = new Set([edge.sourceId, edge.targetId, ...edge.solidOverNodeIds]);
    const blockerOccluders = flattenOccluders([
      ...expandedNodeOccluders
        .filter((node) => !excluded.has(node.id) && intersectsPath(node.rect))
        .map((node) => node.rect),
      ...contentOccluders.filter(intersectsPath),
    ]);
    return {
      ...edge,
      blockerOccluders,
      solidClipPath: buildClipPathFromOccluders({
        include: [overlayWorldBounds],
        exclude: blockerOccluders,
      }),
      blockedClipPath: buildClipPathFromOccluders({ include: blockerOccluders }),
    } satisfies ResolvedOverlayEdgeView;
  });

  return {
    shellOccluders,
    contentOccluders,
    overlayWorldBounds,
    edges: resolvedEdges,
  };
};

// The interaction path is 28 world units wide. Include that full envelope,
// plus seam padding, when discarding blockers outside a routed path.
const PATH_ENVELOPE = 15;
const edgePathSegmentBounds = (path: string): CanvasOverlayOccluder[] | undefined => {
  const segments = [...path.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)];
  const boxes: CanvasOverlayOccluder[] = [];
  let current: { x: number; y: number } | undefined;
  for (const [, command, raw] of segments) {
    const values = raw.trim().split(/[ ,]+/).map(Number);
    if (values.some((value) => !Number.isFinite(value))) return undefined;
    if (command === 'M' && values.length === 2) {
      current = { x: values[0], y: values[1] };
      continue;
    }
    if (!current) return undefined;
    let next: { x: number; y: number };
    let arcPadding = 0;
    if (command === 'L' && values.length === 2) {
      next = { x: values[0], y: values[1] };
    } else if (
      command === 'A' &&
      values.length === 7 &&
      values[2] === 0 &&
      values[3] === 0 &&
      values[0] === values[1]
    ) {
      // Production routes use circular quarter-arcs. Use a conservative full
      // circle envelope rather than relying on the endpoint bounding box.
      next = { x: values[5], y: values[6] };
      const radius = Math.max(
        Math.abs(values[0]),
        Math.hypot(next.x - current.x, next.y - current.y) / 2,
      );
      arcPadding = radius * 2;
    } else {
      // Unknown path syntax (including legacy cubic fixtures) keeps all blockers.
      return undefined;
    }
    const padding = PATH_ENVELOPE + arcPadding;
    boxes.push({
      x: Math.min(current.x, next.x) - padding,
      y: Math.min(current.y, next.y) - padding,
      width: Math.abs(next.x - current.x) + padding * 2,
      height: Math.abs(next.y - current.y) + padding * 2,
    });
    current = next;
  }
  return boxes.length > 0 ? boxes : undefined;
};

const geometryBySnapshot = new WeakMap<CanvasRenderSnapshot, EdgeOverlayRenderState>();

/** Geometry follows the displayed snapshot; selection/search decorations remain live. */
export const resolveCachedEdgeOverlayRenderState = (
  snapshot: CanvasRenderSnapshot,
  edges: CanvasOverlayEdgeView[] = snapshot.overlayEdges,
): EdgeOverlayRenderState => {
  let cached = geometryBySnapshot.get(snapshot);
  if (!cached) {
    cached = resolveEdgeOverlayRenderState({ nodes: snapshot.nodes, edges: snapshot.overlayEdges });
    geometryBySnapshot.set(snapshot, cached);
  }
  if (edges === snapshot.overlayEdges) return cached;
  const byId = new Map(cached.edges.map((edge) => [edge.id, edge]));
  if (edges.some((edge) => !byId.has(edge.id)))
    return resolveEdgeOverlayRenderState({ nodes: snapshot.nodes, edges });
  return {
    ...cached,
    edges: edges.map((edge) => {
      const geometry = byId.get(edge.id);
      if (!geometry) throw new Error(`Missing cached geometry for edge ${edge.id}`);
      return {
        ...edge,
        blockerOccluders: geometry.blockerOccluders,
        solidClipPath: geometry.solidClipPath,
        blockedClipPath: geometry.blockedClipPath,
      };
    }),
  };
};
