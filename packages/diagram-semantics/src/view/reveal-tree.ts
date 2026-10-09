import {
  type CanonicalTree,
  collectDescendantIds,
  getChildren,
  type TreeNodeLike,
} from '../tree/canonical-tree';

export interface RevealEdge {
  id: string;
  from: string;
  to: string;
}
export interface RevealAnnotations {
  scopeBoundaryId: string;
  includedNodeIds: Set<string>;
}

/** Shared visibility closure for view compilation and search-reveal operations. */
export function resolveRevealAnnotations<TNode extends TreeNodeLike<TNode>>(params: {
  tree: CanonicalTree<TNode>;
  expanded?: Record<string, boolean>;
  scopeRootId?: string;
  targetNodeIds?: Set<string>;
  targetEdgeIds?: Set<string>;
  edges?: RevealEdge[];
  forceExpandToTargets?: boolean;
}): RevealAnnotations {
  const {
    tree,
    expanded,
    scopeRootId,
    targetNodeIds,
    targetEdgeIds,
    edges = [],
    forceExpandToTargets = false,
  } = params;
  const fullyExpanded = expanded === undefined;
  const scopeBoundaryId = scopeRootId && tree.byId.has(scopeRootId) ? scopeRootId : tree.rootId;
  const scopeIds =
    scopeBoundaryId === tree.rootId
      ? undefined
      : collectDescendantIds(tree, scopeBoundaryId, { includeRoot: true });
  const isInScope = (id: string) => tree.byId.has(id) && (!scopeIds || scopeIds.has(id));
  const seedIds = new Set([...(targetNodeIds ?? [])].filter(isInScope));
  for (const edge of edges) {
    if (!targetEdgeIds?.has(edge.id)) continue;
    if (isInScope(edge.from)) seedIds.add(edge.from);
    if (isInScope(edge.to)) seedIds.add(edge.to);
  }
  const hasTargetQuery = targetNodeIds !== undefined || targetEdgeIds !== undefined;
  const targetClosureIds = new Set<string>();
  for (const id of seedIds) {
    let current: string | undefined = id;
    while (current && current !== tree.rootId && current !== scopeBoundaryId) {
      targetClosureIds.add(current);
      current = tree.byId.get(current)?.parentId;
    }
  }
  const includedNodeIds = new Set<string>();
  const visit = (node: TNode) => {
    if (hasTargetQuery && !targetClosureIds.has(node.id)) return;
    includedNodeIds.add(node.id);
    if (fullyExpanded || expanded?.[node.id] || (forceExpandToTargets && hasTargetQuery)) {
      for (const child of node.children) visit(child);
    }
  };
  const roots =
    scopeBoundaryId === tree.rootId ? tree.root.children : getChildren(tree, scopeBoundaryId);
  for (const child of roots) visit(child);
  return { scopeBoundaryId, includedNodeIds };
}
