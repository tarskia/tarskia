import type { ViewportState } from '@tarskia/diagram-semantics';
import {
  computeViewportForBoundsInVisibleCanvas,
  computeViewportToKeepRectVisible,
} from '../../viewport-visibility';
import type { LayoutResult } from '../layout/layout-pipeline';
import { DEFAULT_VIEWPORT_FIT_PADDING } from './animation-constants';

export type TransitionCameraFocus =
  | { kind: 'single'; rootId: string }
  | { kind: 'local'; rootId: string }
  | { kind: 'global' };

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type CollapseCorridorTargets = {
  anchorId: string;
  startBounds: Bounds | null;
  endBounds: Bounds | null;
  corridorBounds: Bounds | null;
};

export interface StructuralCameraAdvisory {
  prelude?: ViewportState;
  epilogue?: ViewportState;
}

type CollapseEpilogueTarget = {
  bounds: Bounds | null;
  recenterEvenIfVisible: boolean;
};

const CAMERA_INFLATE_X = 24;
const CAMERA_INFLATE_Y = 48;

const VIEWPORT_EPSILON = 0.0001;

const getNodeDepth = (layout: LayoutResult, nodeId: string) => {
  let depth = 0;
  let current = layout.tree.byId.get(nodeId)?.parentId;
  while (current && current !== layout.tree.rootId) {
    depth += 1;
    current = layout.tree.byId.get(current)?.parentId;
  }
  return depth;
};

const getNodeBounds = (layout: LayoutResult, nodeId: string): Bounds | null => {
  const node = layout.tree.byId.get(nodeId);
  const position = layout.absolutePositions[nodeId];
  if (!node || !position) {
    return null;
  }
  return {
    minX: position.x,
    minY: position.y,
    maxX: position.x + node.size.width,
    maxY: position.y + node.size.height,
  };
};

const unionBounds = (a: Bounds, b: Bounds): Bounds => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

const containsPoint = (bounds: Bounds, point: { x: number; y: number }) =>
  point.x >= bounds.minX &&
  point.x <= bounds.maxX &&
  point.y >= bounds.minY &&
  point.y <= bounds.maxY;

const containsBounds = (viewRect: Bounds, bounds: Bounds, tolerance = 0) =>
  bounds.minX >= viewRect.minX - tolerance &&
  bounds.minY >= viewRect.minY - tolerance &&
  bounds.maxX <= viewRect.maxX + tolerance &&
  bounds.maxY <= viewRect.maxY + tolerance;

const inflateBounds = (bounds: Bounds): Bounds => ({
  minX: bounds.minX - CAMERA_INFLATE_X,
  minY: bounds.minY - CAMERA_INFLATE_Y,
  maxX: bounds.maxX + CAMERA_INFLATE_X,
  maxY: bounds.maxY + CAMERA_INFLATE_Y,
});

const paddingToSceneTolerance = (padding: number, zoom: number) => padding / Math.max(zoom, 0.001);

const viewportEquals = (
  left: ViewportState | null | undefined,
  right: ViewportState | null | undefined,
) =>
  Math.abs((left?.x ?? 0) - (right?.x ?? 0)) <= VIEWPORT_EPSILON &&
  Math.abs((left?.y ?? 0) - (right?.y ?? 0)) <= VIEWPORT_EPSILON &&
  Math.abs((left?.zoom ?? 1) - (right?.zoom ?? 1)) <= VIEWPORT_EPSILON;

const getViewportCenter = (params: {
  viewport: ViewportState;
  canvas: { width: number; height: number };
}) => {
  const { viewport, canvas } = params;
  const minX = -viewport.x / viewport.zoom;
  const minY = -viewport.y / viewport.zoom;
  const maxX = (-viewport.x + canvas.width) / viewport.zoom;
  const maxY = (-viewport.y + canvas.height) / viewport.zoom;
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
};

const pickViewportAnchorId = (layout: LayoutResult, point: { x: number; y: number }) => {
  const containing: Array<{ id: string; depth: number; area: number }> = [];
  let nearest:
    | {
        id: string;
        distanceSquared: number;
      }
    | undefined;

  for (const id of layout.visibleIds) {
    const bounds = getNodeBounds(layout, id);
    if (!bounds) {
      continue;
    }
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const dx = centerX - point.x;
    const dy = centerY - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = { id, distanceSquared };
    }
    if (!containsPoint(bounds, point)) {
      continue;
    }
    containing.push({
      id,
      depth: getNodeDepth(layout, id),
      area: Math.max(1, bounds.maxX - bounds.minX) * Math.max(1, bounds.maxY - bounds.minY),
    });
  }

  if (containing.length > 0) {
    containing.sort((left, right) => {
      if (left.depth !== right.depth) {
        return right.depth - left.depth;
      }
      return left.area - right.area;
    });
    return containing[0]?.id;
  }
  return nearest?.id;
};

const resolveAnchorId = (params: {
  fromLayout: LayoutResult;
  focus: TransitionCameraFocus;
  currentViewport: ViewportState;
  canvasSize: { width: number; height: number };
  collectSubtreeIds: (tree: LayoutResult['tree'], rootId: string) => Set<string>;
}) => {
  const { fromLayout, focus, currentViewport, canvasSize, collectSubtreeIds } = params;
  if (focus.kind === 'single') {
    return focus.rootId;
  }

  const viewportCenter = getViewportCenter({
    viewport: currentViewport,
    canvas: canvasSize,
  });
  const viewportAnchorId = pickViewportAnchorId(fromLayout, viewportCenter);
  if (!viewportAnchorId) {
    return focus.kind === 'global' ? undefined : focus.rootId;
  }
  if (focus.kind === 'global') {
    return viewportAnchorId;
  }
  const subtreeIds = collectSubtreeIds(fromLayout.tree, focus.rootId);
  return subtreeIds.has(viewportAnchorId) ? viewportAnchorId : focus.rootId;
};

const resolveSurvivingAncestorId = (params: {
  fromLayout: LayoutResult;
  toLayout: LayoutResult;
  anchorId: string;
}) => {
  const { fromLayout, toLayout, anchorId } = params;
  let current: string | undefined = anchorId;
  while (current && current !== fromLayout.tree.rootId) {
    if (toLayout.tree.byId.has(current)) {
      return current;
    }
    current = fromLayout.tree.byId.get(current)?.parentId;
  }
  return undefined;
};

const resolveCollapseCorridorTargets = (params: {
  fromLayout: LayoutResult;
  toLayout: LayoutResult;
  focus: TransitionCameraFocus;
  currentViewport: ViewportState;
  canvasSize: { width: number; height: number };
  collectSubtreeIds: (tree: LayoutResult['tree'], rootId: string) => Set<string>;
}): CollapseCorridorTargets | null => {
  const { fromLayout, toLayout, focus, currentViewport, canvasSize, collectSubtreeIds } = params;
  const anchorId = resolveAnchorId({
    fromLayout,
    focus,
    currentViewport,
    canvasSize,
    collectSubtreeIds,
  });
  if (!anchorId) {
    return null;
  }

  const startBounds = getNodeBounds(fromLayout, anchorId);
  const survivingAncestorId = resolveSurvivingAncestorId({
    fromLayout,
    toLayout,
    anchorId,
  });
  const endBounds = survivingAncestorId ? getNodeBounds(toLayout, survivingAncestorId) : null;
  const corridorBounds =
    startBounds && endBounds ? unionBounds(startBounds, endBounds) : (startBounds ?? endBounds);

  return {
    anchorId,
    startBounds,
    endBounds,
    corridorBounds,
  };
};

const isCollapseAnchorJourneyVisible = (params: {
  fromLayout: LayoutResult;
  toLayout: LayoutResult;
  focus: TransitionCameraFocus;
  currentViewport: ViewportState;
  canvasSize: { width: number; height: number };
  collectSubtreeIds: (tree: LayoutResult['tree'], rootId: string) => Set<string>;
  tolerance?: number;
}) => {
  const targets = resolveCollapseCorridorTargets(params);
  if (!targets?.startBounds || !targets.endBounds) {
    return false;
  }
  const tolerance = params.tolerance ?? 0;
  const viewRect = computeVisibleViewRect({
    viewport: params.currentViewport,
    canvas: params.canvasSize,
  });
  const containsTargetBounds = (bounds: Bounds) =>
    bounds.minX >= viewRect.minX - tolerance &&
    bounds.minY >= viewRect.minY - tolerance &&
    bounds.maxX <= viewRect.maxX + tolerance &&
    bounds.maxY <= viewRect.maxY + tolerance;

  return containsTargetBounds(targets.startBounds) && containsTargetBounds(targets.endBounds);
};

const resolveCollapseCorridorBounds = (params: {
  fromLayout: LayoutResult;
  toLayout: LayoutResult;
  focus: TransitionCameraFocus;
  currentViewport: ViewportState;
  canvasSize: { width: number; height: number };
  collectSubtreeIds: (tree: LayoutResult['tree'], rootId: string) => Set<string>;
}): Bounds | null => resolveCollapseCorridorTargets(params)?.corridorBounds ?? null;

const computeVisibleViewRect = (params: {
  viewport: ViewportState;
  canvas: { width: number; height: number };
}) => {
  const { viewport, canvas } = params;
  const minX = -viewport.x / viewport.zoom;
  const minY = -viewport.y / viewport.zoom;
  const maxX = (-viewport.x + canvas.width) / viewport.zoom;
  const maxY = (-viewport.y + canvas.height) / viewport.zoom;
  return { minX, minY, maxX, maxY };
};

const computeViewportForVisibleBounds = (params: {
  bounds: Bounds;
  canvas: { width: number; height: number };
  minZoom: number;
  maxZoom: number;
}) =>
  computeViewportForBoundsInVisibleCanvas({
    bounds: {
      x: params.bounds.minX,
      y: params.bounds.minY,
      width: Math.max(1, params.bounds.maxX - params.bounds.minX),
      height: Math.max(1, params.bounds.maxY - params.bounds.minY),
    },
    canvas: params.canvas,
    minZoom: params.minZoom,
    maxZoom: params.maxZoom,
    padding: DEFAULT_VIEWPORT_FIT_PADDING,
  });

const toViewportBounds = (layout: LayoutResult, nodeIds: string[]) => {
  let bounds: Bounds | null = null;
  for (const nodeId of nodeIds) {
    const nodeBounds = getNodeBounds(layout, nodeId);
    if (!nodeBounds) {
      continue;
    }
    bounds = bounds ? unionBounds(bounds, nodeBounds) : nodeBounds;
  }
  return bounds;
};

const isTopLevelVisibleNode = (layout: LayoutResult, nodeId: string) =>
  layout.tree.byId.get(nodeId)?.parentId === layout.tree.rootId;

const isSingleChildChainToTopLevel = (layout: LayoutResult, nodeId: string) => {
  let currentId: string | undefined = nodeId;
  while (currentId) {
    const currentNode = layout.tree.byId.get(currentId);
    if (!currentNode?.parentId) {
      return false;
    }
    if (currentNode.parentId === layout.tree.rootId) {
      return true;
    }
    const parentNode = layout.tree.byId.get(currentNode.parentId);
    if (!parentNode || parentNode.children.length !== 1) {
      return false;
    }
    currentId = parentNode.id;
  }
  return false;
};

const resolveCollapseEpilogueTarget = (params: {
  focus: TransitionCameraFocus | null;
  startLayout: LayoutResult;
  endLayout: LayoutResult;
  currentViewport: ViewportState;
  canvasSize: { width: number; height: number };
  endPointOfInterestNodeIds: string[];
  collectSubtreeIds: (tree: LayoutResult['tree'], rootId: string) => Set<string>;
}): CollapseEpilogueTarget => {
  const {
    focus,
    startLayout,
    endLayout,
    currentViewport,
    canvasSize,
    endPointOfInterestNodeIds,
    collectSubtreeIds,
  } = params;

  const sceneBounds = toViewportBounds(endLayout, Array.from(endLayout.visibleIds));
  const endBounds = toViewportBounds(endLayout, endPointOfInterestNodeIds);

  if (!focus) {
    return {
      bounds: endBounds,
      recenterEvenIfVisible: false,
    };
  }

  if (focus.kind === 'global') {
    return {
      bounds: sceneBounds ?? endBounds,
      recenterEvenIfVisible: true,
    };
  }

  const collapseTargets = resolveCollapseCorridorTargets({
    fromLayout: startLayout,
    toLayout: endLayout,
    focus,
    currentViewport,
    canvasSize,
    collectSubtreeIds,
  });
  const survivingAncestorId = collapseTargets?.anchorId
    ? resolveSurvivingAncestorId({
        fromLayout: startLayout,
        toLayout: endLayout,
        anchorId: collapseTargets.anchorId,
      })
    : undefined;

  if (!survivingAncestorId) {
    return {
      bounds: endBounds,
      recenterEvenIfVisible: false,
    };
  }

  if (
    isTopLevelVisibleNode(endLayout, survivingAncestorId) ||
    isSingleChildChainToTopLevel(endLayout, survivingAncestorId)
  ) {
    return {
      bounds: sceneBounds ?? endBounds,
      recenterEvenIfVisible: true,
    };
  }

  return {
    bounds: endBounds,
    recenterEvenIfVisible: false,
  };
};

export const buildStructuralCameraAdvisory = (params: {
  direction: 'in' | 'out';
  focus: TransitionCameraFocus | null;
  startLayout: LayoutResult;
  endLayout: LayoutResult;
  currentViewport: ViewportState;
  canvasSize: { width: number; height: number } | null;
  endPointOfInterestNodeIds: string[];
  collectSubtreeIds: (tree: LayoutResult['tree'], rootId: string) => Set<string>;
  padding: number;
  minZoom: number;
  maxZoom: number;
}): StructuralCameraAdvisory => {
  const {
    direction,
    focus,
    startLayout,
    endLayout,
    currentViewport,
    canvasSize,
    endPointOfInterestNodeIds,
    collectSubtreeIds,
    padding,
    minZoom,
    maxZoom,
  } = params;
  if (!canvasSize) {
    return {};
  }

  const advisory: StructuralCameraAdvisory = {};
  const collapseEpilogueTarget =
    direction === 'out'
      ? resolveCollapseEpilogueTarget({
          focus,
          startLayout,
          endLayout,
          currentViewport,
          canvasSize,
          endPointOfInterestNodeIds,
          collectSubtreeIds,
        })
      : null;
  const endBounds =
    direction === 'out'
      ? (collapseEpilogueTarget?.bounds ?? null)
      : toViewportBounds(endLayout, endPointOfInterestNodeIds);

  if (direction === 'in') {
    if (!endBounds) return advisory;
    const rect = {
      x: endBounds.minX,
      y: endBounds.minY,
      width: endBounds.maxX - endBounds.minX,
      height: endBounds.maxY - endBounds.minY,
    };
    const fits =
      rect.width * currentViewport.zoom <= Math.max(1, canvasSize.width - padding * 2) &&
      rect.height * currentViewport.zoom <= Math.max(1, canvasSize.height - padding * 2);
    const next = fits
      ? computeViewportToKeepRectVisible({
          viewport: currentViewport,
          canvas: canvasSize,
          rect,
          padding,
        })
      : computeViewportForVisibleBounds({
          bounds: endBounds,
          canvas: canvasSize,
          minZoom,
          maxZoom: Math.min(maxZoom, currentViewport.zoom),
        });
    if (next && !viewportEquals(currentViewport, next)) advisory.prelude = next;
    return advisory;
  }

  if (direction === 'out' && focus) {
    const rawCorridorBounds = resolveCollapseCorridorBounds({
      fromLayout: startLayout,
      toLayout: endLayout,
      focus,
      currentViewport,
      canvasSize,
      collectSubtreeIds,
    });
    if (rawCorridorBounds) {
      const relaxedTolerance = (padding * 2) / Math.max(currentViewport.zoom, 0.001);
      const journeyVisible = isCollapseAnchorJourneyVisible({
        fromLayout: startLayout,
        toLayout: endLayout,
        focus,
        currentViewport,
        canvasSize,
        collectSubtreeIds,
        tolerance: relaxedTolerance,
      });
      const currentViewRect = computeVisibleViewRect({
        viewport: currentViewport,
        canvas: canvasSize,
      });
      const corridorAlreadyFits = containsBounds(
        currentViewRect,
        rawCorridorBounds,
        relaxedTolerance,
      );
      if (!journeyVisible && !corridorAlreadyFits) {
        advisory.prelude = computeViewportForVisibleBounds({
          bounds: inflateBounds(rawCorridorBounds),
          canvas: canvasSize,
          minZoom,
          maxZoom,
        });
      }
    }
  }

  const postPreludeViewport = advisory.prelude ?? currentViewport;
  const postPreludeTolerance = paddingToSceneTolerance(padding, postPreludeViewport.zoom);
  const postPreludeViewRect = computeVisibleViewRect({
    viewport: postPreludeViewport,
    canvas: canvasSize,
  });
  if (endBounds) {
    const epilogueViewport = computeViewportForVisibleBounds({
      bounds: endBounds,
      canvas: canvasSize,
      minZoom,
      maxZoom,
    });
    const shouldRecentreCollapse =
      direction === 'out' && Boolean(collapseEpilogueTarget?.recenterEvenIfVisible);
    const needsVisibilityFit = !containsBounds(
      postPreludeViewRect,
      endBounds,
      postPreludeTolerance,
    );
    if (
      (shouldRecentreCollapse && !viewportEquals(postPreludeViewport, epilogueViewport)) ||
      (!shouldRecentreCollapse && needsVisibilityFit)
    ) {
      advisory.epilogue = epilogueViewport;
    }
  }

  return advisory;
};
