import {
  type CanvasHandleSide,
  type CanvasPoint,
  type CanvasRect,
  resolveHorizontalHandleSides,
} from './geometry';

export interface AnchoredEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceRect: CanvasRect;
  targetRect: CanvasRect;
  sourceSide?: CanvasHandleSide;
  targetSide?: CanvasHandleSide;
}

export interface AssignedEdgeAnchors {
  sourceSide: CanvasHandleSide;
  targetSide: CanvasHandleSide;
  sourcePoint: CanvasPoint;
  targetPoint: CanvasPoint;
}

/** Incoming and outgoing edges share a side's slots, ordered by their other endpoint. */
export const assignDistributedEdgeAnchors = (edges: AnchoredEdge[]) => {
  const assignments = new Map<string, AssignedEdgeAnchors>();
  const sides = new Map<
    string,
    { edge: AnchoredEdge; role: 'source' | 'target'; otherY: number }[]
  >();
  for (const edge of edges) {
    const defaultSides = resolveHorizontalHandleSides(edge.sourceRect, edge.targetRect);
    const sourceSide = edge.sourceSide ?? defaultSides.sourceSide;
    const targetSide = edge.targetSide ?? defaultSides.targetSide;
    assignments.set(edge.id, {
      sourceSide,
      targetSide,
      sourcePoint: { x: 0, y: 0 },
      targetPoint: { x: 0, y: 0 },
    });
    for (const role of ['source', 'target'] as const) {
      const side = role === 'source' ? sourceSide : targetSide;
      const other = role === 'source' ? edge.targetRect : edge.sourceRect;
      const key = `${role === 'source' ? edge.sourceId : edge.targetId}:${side}`;
      const bucket = sides.get(key) ?? [];
      bucket.push({ edge, role, otherY: other.y + other.height / 2 });
      sides.set(key, bucket);
    }
  }
  for (const bucket of sides.values()) {
    bucket.sort(
      (a, b) =>
        a.otherY - b.otherY || a.edge.id.localeCompare(b.edge.id) || a.role.localeCompare(b.role),
    );
    bucket.forEach(({ edge, role }, index) => {
      const assigned = assignments.get(edge.id)!;
      const rect = role === 'source' ? edge.sourceRect : edge.targetRect;
      const side = role === 'source' ? assigned.sourceSide : assigned.targetSide;
      const point = {
        x: side === 'right' ? rect.x + rect.width : rect.x,
        y: rect.y + (rect.height * (index + 1)) / (bucket.length + 1),
      };
      if (role === 'source') assigned.sourcePoint = point;
      else assigned.targetPoint = point;
    });
  }
  return assignments;
};
