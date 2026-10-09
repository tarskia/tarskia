export interface DirectionalEdgeLabel {
  sourceId: string;
  targetId: string;
  relationId: string;
  label?: string;
}

export const joinDirectionalLabels = (directions: DirectionalEdgeLabel[]) =>
  [...new Set(directions.map((direction) => direction.label).filter(Boolean))].join(' / ') ||
  undefined;
