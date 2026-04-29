import type { CanvasEdgeGeometry, CanvasPoint } from '../../rendering/presentation/geometry';

const HORIZONTAL_LABEL_NUDGE_PX = 11;
const VERTICAL_LABEL_NUDGE_PX = 14;

type EdgeLabelGeometry = Pick<
  CanvasEdgeGeometry,
  'sourcePoint' | 'targetPoint' | 'sourceSide' | 'targetSide'
>;

const isHorizontalFlow = (geometry: EdgeLabelGeometry) =>
  (geometry.sourceSide === 'right' && geometry.targetSide === 'left') ||
  (geometry.sourceSide === 'left' && geometry.targetSide === 'right');

const isVerticalFlow = (geometry: EdgeLabelGeometry) =>
  (geometry.sourceSide === 'bottom' && geometry.targetSide === 'top') ||
  (geometry.sourceSide === 'top' && geometry.targetSide === 'bottom');

export const resolveEdgeLabelOffset = (geometry: EdgeLabelGeometry): CanvasPoint => {
  if (isHorizontalFlow(geometry)) {
    return Math.abs(geometry.sourcePoint.y - geometry.targetPoint.y) < 1
      ? { x: 0, y: -HORIZONTAL_LABEL_NUDGE_PX }
      : { x: VERTICAL_LABEL_NUDGE_PX, y: 0 };
  }

  if (isVerticalFlow(geometry)) {
    return Math.abs(geometry.sourcePoint.x - geometry.targetPoint.x) < 1
      ? { x: VERTICAL_LABEL_NUDGE_PX, y: 0 }
      : { x: 0, y: -HORIZONTAL_LABEL_NUDGE_PX };
  }

  const dx = geometry.targetPoint.x - geometry.sourcePoint.x;
  const dy = geometry.targetPoint.y - geometry.sourcePoint.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: 0, y: -HORIZONTAL_LABEL_NUDGE_PX }
    : { x: VERTICAL_LABEL_NUDGE_PX, y: 0 };
};

export const resolveEdgeLabelTransform = (params: {
  labelAnchor: CanvasPoint;
  geometry: EdgeLabelGeometry;
}) => {
  const offset = resolveEdgeLabelOffset(params.geometry);
  return `translate(-50%, -50%) translate(${params.labelAnchor.x + offset.x}px, ${params.labelAnchor.y + offset.y}px)`;
};
