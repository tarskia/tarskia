export type CanvasHandleSide = 'left' | 'right' | 'top' | 'bottom';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const offsetRect = (rect: CanvasRect, dx: number, dy: number): CanvasRect => ({
  ...rect,
  x: rect.x + dx,
  y: rect.y + dy,
});

export interface CanvasEdgeGeometry {
  sourcePoint: CanvasPoint;
  control1: CanvasPoint;
  control2: CanvasPoint;
  targetPoint: CanvasPoint;
  path: string;
  labelAnchor: CanvasPoint;
  sourceSide: CanvasHandleSide;
  targetSide: CanvasHandleSide;
}

const resolveHandlePoint = (rect: CanvasRect, side: CanvasHandleSide): CanvasPoint => {
  switch (side) {
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    default:
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
};

export const resolveHorizontalHandleSides = (
  sourceRect: CanvasRect,
  targetRect: CanvasRect,
): { sourceSide: CanvasHandleSide; targetSide: CanvasHandleSide } => {
  const sourceCenterX = sourceRect.x + sourceRect.width / 2;
  const targetCenterX = targetRect.x + targetRect.width / 2;
  const flowLeft = targetCenterX < sourceCenterX;
  return {
    sourceSide: flowLeft ? 'left' : 'right',
    targetSide: flowLeft ? 'right' : 'left',
  };
};

// --- Orthogonal (step) edge routing ---

const CORNER_RADIUS = 4;
const MIN_STUB = 16;

/**
 * Build a rounded right-angle corner arc segment.
 * Returns an SVG arc command string from the approach point through the corner.
 */
const roundedCorner = (
  from: CanvasPoint,
  corner: CanvasPoint,
  to: CanvasPoint,
  r: number,
): string => {
  const dx1 = corner.x - from.x;
  const dy1 = corner.y - from.y;
  const dx2 = to.x - corner.x;
  const dy2 = to.y - corner.y;
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  const clampedR = Math.min(r, len1 / 2, len2 / 2);
  if (clampedR < 1) {
    return `L ${corner.x},${corner.y}`;
  }
  const arcStart = {
    x: corner.x - (dx1 / len1) * clampedR,
    y: corner.y - (dy1 / len1) * clampedR,
  };
  const arcEnd = {
    x: corner.x + (dx2 / len2) * clampedR,
    y: corner.y + (dy2 / len2) * clampedR,
  };
  const sweep = dx1 * dy2 - dy1 * dx2 > 0 ? 1 : 0;
  return `L ${arcStart.x},${arcStart.y} A ${clampedR},${clampedR} 0 0 ${sweep} ${arcEnd.x},${arcEnd.y}`;
};

const buildOrthogonalPath = (
  source: CanvasPoint,
  target: CanvasPoint,
  sourceSide: CanvasHandleSide,
  targetSide: CanvasHandleSide,
): { path: string; labelAnchor: CanvasPoint } => {
  // Horizontal flow (left/right handles): step edge with vertical segment
  if (
    (sourceSide === 'right' && targetSide === 'left') ||
    (sourceSide === 'left' && targetSide === 'right')
  ) {
    const dir = sourceSide === 'right' ? 1 : -1;
    const gap = (target.x - source.x) * dir;
    // If target is behind source, route around with extra stubs
    const midX =
      gap > MIN_STUB * 2 ? source.x + (target.x - source.x) / 2 : source.x + dir * MIN_STUB;

    if (Math.abs(source.y - target.y) < 1) {
      // Straight horizontal line
      return {
        path: `M ${source.x},${source.y} L ${target.x},${target.y}`,
        labelAnchor: { x: (source.x + target.x) / 2, y: source.y },
      };
    }

    const corner1: CanvasPoint = { x: midX, y: source.y };
    const corner2: CanvasPoint = { x: midX, y: target.y };

    const seg1 = roundedCorner(source, corner1, corner2, CORNER_RADIUS);
    const seg2 = roundedCorner(corner1, corner2, target, CORNER_RADIUS);

    return {
      path: `M ${source.x},${source.y} ${seg1} ${seg2} L ${target.x},${target.y}`,
      labelAnchor: { x: midX, y: (source.y + target.y) / 2 },
    };
  }

  // Vertical flow (top/bottom handles): step edge with horizontal segment
  if (
    (sourceSide === 'bottom' && targetSide === 'top') ||
    (sourceSide === 'top' && targetSide === 'bottom')
  ) {
    const midY = source.y + (target.y - source.y) / 2;

    if (Math.abs(source.x - target.x) < 1) {
      return {
        path: `M ${source.x},${source.y} L ${target.x},${target.y}`,
        labelAnchor: { x: source.x, y: midY },
      };
    }

    const corner1: CanvasPoint = { x: source.x, y: midY };
    const corner2: CanvasPoint = { x: target.x, y: midY };

    const seg1 = roundedCorner(source, corner1, corner2, CORNER_RADIUS);
    const seg2 = roundedCorner(corner1, corner2, target, CORNER_RADIUS);

    return {
      path: `M ${source.x},${source.y} ${seg1} ${seg2} L ${target.x},${target.y}`,
      labelAnchor: { x: (source.x + target.x) / 2, y: midY },
    };
  }

  // Mixed handles (e.g., right -> top): single right-angle corner
  const corner: CanvasPoint = {
    x: sourceSide === 'left' || sourceSide === 'right' ? target.x : source.x,
    y: sourceSide === 'top' || sourceSide === 'bottom' ? target.y : source.y,
  };
  const seg = roundedCorner(source, corner, target, CORNER_RADIUS);

  return {
    path: `M ${source.x},${source.y} ${seg} L ${target.x},${target.y}`,
    labelAnchor: { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 },
  };
};

// --- Public API (replaces bezier) ---

export const buildBezierEdgeGeometry = (params: {
  sourceRect: CanvasRect;
  targetRect: CanvasRect;
  sourceSide?: CanvasHandleSide;
  targetSide?: CanvasHandleSide;
  sourcePointOverride?: CanvasPoint;
  targetPointOverride?: CanvasPoint;
}): CanvasEdgeGeometry => {
  const { sourceRect, targetRect } = params;
  const { sourceSide, targetSide } =
    params.sourceSide && params.targetSide
      ? { sourceSide: params.sourceSide, targetSide: params.targetSide }
      : resolveHorizontalHandleSides(sourceRect, targetRect);
  const sourcePoint = params.sourcePointOverride ?? resolveHandlePoint(sourceRect, sourceSide);
  const targetPoint = params.targetPointOverride ?? resolveHandlePoint(targetRect, targetSide);
  const { path, labelAnchor } = buildOrthogonalPath(
    sourcePoint,
    targetPoint,
    sourceSide,
    targetSide,
  );

  // control1/control2 kept for interface compatibility (used by transition overlay)
  const midX = (sourcePoint.x + targetPoint.x) / 2;

  return {
    sourcePoint,
    control1: { x: midX, y: sourcePoint.y },
    control2: { x: midX, y: targetPoint.y },
    targetPoint,
    path,
    labelAnchor,
    sourceSide,
    targetSide,
  };
};

export const buildBezierPath = ({
  sourcePoint,
  control1,
  control2,
  targetPoint,
}: Pick<CanvasEdgeGeometry, 'sourcePoint' | 'control1' | 'control2' | 'targetPoint'>) => {
  // Use orthogonal routing for consistency
  const sourceSide = control1.x > sourcePoint.x ? 'right' : 'left';
  const targetSide = control2.x < targetPoint.x ? 'left' : 'right';
  const { path } = buildOrthogonalPath(
    sourcePoint,
    targetPoint,
    sourceSide as CanvasHandleSide,
    targetSide as CanvasHandleSide,
  );
  return path;
};
