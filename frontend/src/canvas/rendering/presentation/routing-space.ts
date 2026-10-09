import type { CompiledDiagramEdge } from '@tarskia/diagram-semantics';
import type { SceneTree } from '../tree/scene-tree';
import { getRoutingChannelReservations, type RoutingNode } from './edge-routing';

/** Shift whole Dagre columns only where their actual lane/label occupancy needs extra space. */
export const reserveScopeRoutingSpace = (
  parentId: string,
  tree: SceneTree,
  edges: CompiledDiagramEdge[],
  positions: Record<string, { x: number; y: number }>,
) => {
  const parent = tree.byId.get(parentId)!;
  const nodes: RoutingNode[] = [];
  const visit = (id: string, x: number, y: number) => {
    const node = tree.byId.get(id)!;
    nodes.push({
      id,
      parentId: node.parentId,
      kind: node.children.length ? 'group' : 'entity',
      rect: { x, y, ...node.size },
    });
    for (const child of node.children)
      visit(child.id, x + (child.position?.x ?? 0), y + (child.position?.y ?? 0));
  };
  for (const child of parent.children)
    visit(child.id, positions[child.id]?.x ?? 0, positions[child.id]?.y ?? 0);
  const reservations = getRoutingChannelReservations(nodes, edges).filter(
    (channel) => channel.parentId === parentId,
  );
  if (!reservations.length) return { positions, extraWidth: 0 };
  const children = nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.rect.x - b.rect.x);
  const columns: { left: number; right: number; ids: string[] }[] = [];
  for (const child of children) {
    const last = columns.at(-1);
    if (last && child.rect.x < last.right) {
      last.right = Math.max(last.right, child.rect.x + child.rect.width);
      last.ids.push(child.id);
    } else
      columns.push({ left: child.rect.x, right: child.rect.x + child.rect.width, ids: [child.id] });
  }
  const demand = (boundary: number, direction: number) =>
    Math.max(
      0,
      ...reservations
        .filter((r) => r.boundary === boundary && r.direction === direction)
        .map((r) => r.space),
    );
  const shifted = { ...positions };
  let shift = demand(columns[0].left, -1);
  for (const [index, column] of columns.entries()) {
    for (const id of column.ids) shifted[id] = { ...positions[id], x: positions[id].x + shift };
    const next = columns[index + 1];
    if (next)
      shift += Math.max(
        0,
        demand(column.right, 1) + demand(next.left, -1) + 8 - (next.left - column.right),
      );
    else shift += demand(column.right, 1);
  }
  return { positions: shifted, extraWidth: shift };
};
