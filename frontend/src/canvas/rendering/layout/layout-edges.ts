import type { CompiledDiagramEdge } from '@tarskia/diagram-semantics';
import { resolveEndpointChildWithinParent } from '../tree/endpoint-projection';
import type { LayoutTree } from './layout-geometry';

export type LayoutEdge = { source: string; target: string };

export function buildLayoutEdgesForParent(params: {
  parentId: string;
  childIds: string[];
  edges: CompiledDiagramEdge[];
  tree: LayoutTree;
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

/** Each relation contributes only at its lowest common ancestor, in relation order. */
export function buildLayoutEdgesByParent(
  tree: LayoutTree,
  edges: CompiledDiagramEdge[],
): Map<string, LayoutEdge[]> {
  const result = new Map<string, LayoutEdge[]>();
  const seen = new Map<string, Set<string>>();
  const paths = new Map<string, Map<string, string>>();
  const pathFor = (id: string) => {
    const cached = paths.get(id);
    if (cached) return cached;
    const path = new Map<string, string>();
    let child = tree.byId.get(id);
    while (child?.parentId) {
      path.set(child.parentId, child.id);
      child = tree.byId.get(child.parentId);
    }
    paths.set(id, path);
    return path;
  };
  for (const edge of edges) {
    const sourcePath = pathFor(edge.sourceId);
    for (const [parentId, target] of pathFor(edge.targetId)) {
      const source = sourcePath.get(parentId);
      if (!source) continue;
      if (source !== target) {
        const key = JSON.stringify([source, target]);
        const parentSeen = seen.get(parentId) ?? new Set<string>();
        if (!parentSeen.has(key)) {
          const parentEdges = result.get(parentId) ?? [];
          parentEdges.push({ source, target });
          result.set(parentId, parentEdges);
          parentSeen.add(key);
          seen.set(parentId, parentSeen);
        }
      }
      break;
    }
  }
  return result;
}
