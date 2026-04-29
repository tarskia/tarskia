import type { CompiledDiagramEdge } from '../../../semantic';
import { resolveEndpointChildWithinParent } from '../tree/endpoint-projection';
import type { SceneTree } from '../tree/scene-tree';

export type LayoutEdge = { source: string; target: string };

export function buildLayoutEdgesForParent(params: {
  parentId: string;
  childIds: string[];
  edges: CompiledDiagramEdge[];
  tree: SceneTree;
}): LayoutEdge[] {
  const { parentId, childIds, edges, tree } = params;
  if (childIds.length === 0 || edges.length === 0) return [];

  const childSet = new Set(childIds);
  const seen = new Set<string>();
  const layoutEdges: LayoutEdge[] = [];

  for (const edge of edges) {
    const source = resolveEndpointChildWithinParent(tree, parentId, childSet, edge.sourceId);
    const target = resolveEndpointChildWithinParent(tree, parentId, childSet, edge.targetId);
    if (!source || !target) continue;
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    layoutEdges.push({ source, target });
  }

  return layoutEdges;
}
