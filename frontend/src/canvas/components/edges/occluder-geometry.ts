import type { CanvasOverlayOccluder } from '../../rendering/presentation/presentation';

export interface EdgeOccluderNode {
  id: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zIndex?: number;
  focusShell?: boolean;
}

export const EDGE_OCCLUDER_SEAM_PADDING = 1;

const rectPathClockwise = (rect: CanvasOverlayOccluder) =>
  `M ${rect.x},${rect.y} H ${rect.x + rect.width} V ${rect.y + rect.height} H ${rect.x} Z`;

const rectPathCounterClockwise = (rect: CanvasOverlayOccluder) =>
  `M ${rect.x},${rect.y} V ${rect.y + rect.height} H ${rect.x + rect.width} V ${rect.y} Z`;

export const expandOccluderRect = (
  rect: CanvasOverlayOccluder,
  padding = EDGE_OCCLUDER_SEAM_PADDING,
): CanvasOverlayOccluder => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2,
  ...(typeof rect.zIndex === 'number' ? { zIndex: rect.zIndex } : {}),
});

export const buildClipPathFromOccluders = (params: {
  include: CanvasOverlayOccluder[];
  exclude?: CanvasOverlayOccluder[];
}) => {
  const includePath = params.include.map(rectPathClockwise);
  const excludePath = (params.exclude ?? []).map(rectPathCounterClockwise);
  return [...includePath, ...excludePath].join(' ');
};

const normalizeOccluder = (rect: CanvasOverlayOccluder): CanvasOverlayOccluder => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
  ...(typeof rect.zIndex === 'number' ? { zIndex: rect.zIndex } : {}),
});

const rectContainsOccluder = (
  outer: CanvasOverlayOccluder,
  inner: CanvasOverlayOccluder,
): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const rectEqualsOccluder = (left: CanvasOverlayOccluder, right: CanvasOverlayOccluder): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

export const collapseNestedOccluders = (
  occluders: CanvasOverlayOccluder[],
): CanvasOverlayOccluder[] => {
  const normalized = occluders.map(normalizeOccluder);
  return normalized.filter((candidate, candidateIndex) => {
    for (let index = 0; index < normalized.length; index += 1) {
      if (index === candidateIndex) {
        continue;
      }
      const outer = normalized[index];
      if (!outer) {
        continue;
      }
      if (!rectContainsOccluder(outer, candidate)) {
        continue;
      }
      if (rectEqualsOccluder(outer, candidate) && index > candidateIndex) {
        continue;
      }
      return false;
    }
    return true;
  });
};

export const flattenOccluders = (occluders: CanvasOverlayOccluder[]): CanvasOverlayOccluder[] => {
  const normalized = occluders
    .map(normalizeOccluder)
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => {
      const areaDelta = right.width * right.height - left.width * left.height;
      if (areaDelta !== 0) {
        return areaDelta;
      }
      if (left.y !== right.y) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });

  const flattened: CanvasOverlayOccluder[] = [];
  for (const occluder of normalized) {
    let uncoveredRegions: CanvasOverlayOccluder[] = [occluder];
    for (const existing of flattened) {
      uncoveredRegions = uncoveredRegions.flatMap((region) =>
        subtractOccluderRect(region, existing),
      );
      if (uncoveredRegions.length === 0) {
        break;
      }
    }
    flattened.push(...uncoveredRegions);
  }

  return flattened;
};

const intersectOccluderRect = (
  left: CanvasOverlayOccluder,
  right: CanvasOverlayOccluder,
): CanvasOverlayOccluder | undefined => {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightX = Math.min(left.x + left.width, right.x + right.width);
  const bottomY = Math.min(left.y + left.height, right.y + right.height);
  if (rightX <= x || bottomY <= y) {
    return undefined;
  }
  return {
    x,
    y,
    width: rightX - x,
    height: bottomY - y,
  };
};

const subtractOccluderRect = (
  rect: CanvasOverlayOccluder,
  cut: CanvasOverlayOccluder,
): CanvasOverlayOccluder[] => {
  const overlap = intersectOccluderRect(rect, cut);
  if (!overlap) {
    return [normalizeOccluder(rect)];
  }

  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const overlapRight = overlap.x + overlap.width;
  const overlapBottom = overlap.y + overlap.height;
  const fragments: CanvasOverlayOccluder[] = [];
  const pushFragment = (fragment: CanvasOverlayOccluder) => {
    if (fragment.width <= 0 || fragment.height <= 0) {
      return;
    }
    fragments.push({
      ...normalizeOccluder(fragment),
      ...(typeof rect.zIndex === 'number' ? { zIndex: rect.zIndex } : {}),
    });
  };

  pushFragment({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: overlap.y - rect.y,
  });
  pushFragment({
    x: rect.x,
    y: overlapBottom,
    width: rect.width,
    height: rectBottom - overlapBottom,
  });
  pushFragment({
    x: rect.x,
    y: overlap.y,
    width: overlap.x - rect.x,
    height: overlap.height,
  });
  pushFragment({
    x: overlapRight,
    y: overlap.y,
    width: rectRight - overlapRight,
    height: overlap.height,
  });
  return fragments;
};

export const resolveVisibleOccluderRegions = (params: {
  branchOccluders: CanvasOverlayOccluder[];
  ghostOccluders: CanvasOverlayOccluder[];
}) => {
  const occluders = [
    ...params.branchOccluders.map((rect, order) => ({
      ...normalizeOccluder(rect),
      kind: 'branch' as const,
      order,
    })),
    ...params.ghostOccluders.map((rect, order) => ({
      ...normalizeOccluder(rect),
      kind: 'ghost' as const,
      order: params.branchOccluders.length + order,
    })),
  ].sort((left, right) => {
    const zOrder = (right.zIndex ?? 0) - (left.zIndex ?? 0);
    return zOrder !== 0 ? zOrder : right.order - left.order;
  });

  const coveredByHigher: CanvasOverlayOccluder[] = [];
  const branchVisible: CanvasOverlayOccluder[] = [];
  const ghostVisible: CanvasOverlayOccluder[] = [];

  for (const occluder of occluders) {
    let visibleRegions: CanvasOverlayOccluder[] = [normalizeOccluder(occluder)];
    for (const higher of coveredByHigher) {
      visibleRegions = visibleRegions.flatMap((region) => subtractOccluderRect(region, higher));
      if (visibleRegions.length === 0) {
        break;
      }
    }
    if (occluder.kind === 'branch') {
      branchVisible.push(...visibleRegions);
    } else {
      ghostVisible.push(...visibleRegions);
    }
    coveredByHigher.push(normalizeOccluder(occluder));
  }

  return {
    branchOccluders: branchVisible,
    ghostOccluders: ghostVisible,
  };
};

export const splitOccludersByNodeIds = (params: {
  nodes: EdgeOccluderNode[];
  solidOverNodeIds: string[];
  excludedNodeIds?: string[];
}) => {
  const solidOverNodeIds = new Set(params.solidOverNodeIds);
  const excludedNodeIds = new Set(params.excludedNodeIds ?? []);
  const branchOccluders: CanvasOverlayOccluder[] = [];
  const ghostOccluders: CanvasOverlayOccluder[] = [];

  for (const node of params.nodes) {
    if (node.focusShell || node.rect.width <= 0 || node.rect.height <= 0) {
      continue;
    }
    if (excludedNodeIds.has(node.id)) {
      continue;
    }
    const occluder = {
      x: node.rect.x,
      y: node.rect.y,
      width: node.rect.width,
      height: node.rect.height,
      ...(typeof node.zIndex === 'number' ? { zIndex: node.zIndex } : {}),
    } satisfies CanvasOverlayOccluder;
    if (solidOverNodeIds.has(node.id)) {
      branchOccluders.push(occluder);
    } else {
      ghostOccluders.push(occluder);
    }
  }

  return { branchOccluders, ghostOccluders };
};
