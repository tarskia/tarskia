import type { Relation } from '../model/types';
import {
  type CanonicalTree,
  collectDescendantIds,
  getChildren,
  indexTree,
  type TreeNodeLike,
} from '../tree/canonical-tree';
import { ROOT_ID, type SemanticEntityNode, type SemanticEntityTree } from '../tree/entity-tree';

export interface RevealMetadata {
  isTarget: boolean;
  isAncestorContext: boolean;
  isRelationEndpoint: boolean;
  isPreservedByExpansion: boolean;
  hasTargetInSubtree: boolean;
}

export interface RevealEdge {
  id: string;
  from: string;
  to: string;
}

export interface BuildRevealedTreeParams<
  TNode extends TreeNodeLike<TNode>,
  TOutputNode extends TreeNodeLike<TOutputNode> & { reveal: RevealMetadata },
> {
  tree: CanonicalTree<TNode>;
  expanded?: Record<string, boolean>;
  scopeRootId?: string;
  targetNodeIds?: Set<string>;
  targetEdgeIds?: Set<string>;
  edges?: RevealEdge[];
  forceExpandToTargets?: boolean;
  preserveExpandedBranches?: boolean;
  cloneRoot: (node: TNode, reveal: RevealMetadata) => TOutputNode;
  cloneNode: (node: TNode, parentId: string, reveal: RevealMetadata) => TOutputNode;
}

export interface RevealedEntityNode extends SemanticEntityNode {
  children: RevealedEntityNode[];
  reveal: RevealMetadata;
}

export type RevealedEntityTree = CanonicalTree<RevealedEntityNode>;

export interface BuildRevealedEntityTreeParams {
  tree: SemanticEntityTree;
  expanded?: Record<string, boolean>;
  scopeRootId?: string;
  targetEntityIds?: Set<string>;
  targetRelationIds?: Set<string>;
  relations?: Relation[];
  forceExpandToTargets?: boolean;
  preserveExpandedBranches?: boolean;
}

export interface RevealAnnotations {
  scopeBoundaryId: string;
  includedNodeIds: Set<string>;
  revealById: Map<string, RevealMetadata>;
}

const EMPTY_REVEAL: RevealMetadata = {
  isTarget: false,
  isAncestorContext: false,
  isRelationEndpoint: false,
  isPreservedByExpansion: false,
  hasTargetInSubtree: false,
};

export function resolveRevealAnnotations<TNode extends TreeNodeLike<TNode>>(params: {
  tree: CanonicalTree<TNode>;
  expanded?: Record<string, boolean>;
  scopeRootId?: string;
  targetNodeIds?: Set<string>;
  targetEdgeIds?: Set<string>;
  edges?: RevealEdge[];
  forceExpandToTargets?: boolean;
  preserveExpandedBranches?: boolean;
}): RevealAnnotations {
  const {
    tree,
    expanded,
    scopeRootId,
    targetNodeIds,
    targetEdgeIds,
    edges = [],
    forceExpandToTargets = false,
    preserveExpandedBranches = false,
  } = params;

  const fullyExpanded = expanded === undefined;
  const scopeBoundaryId = scopeRootId && tree.byId.has(scopeRootId) ? scopeRootId : tree.rootId;
  const scopeIds =
    scopeBoundaryId === tree.rootId
      ? undefined
      : collectDescendantIds(tree, scopeBoundaryId, { includeRoot: true });
  const isInScope = (id: string) => tree.byId.has(id) && (scopeIds ? scopeIds.has(id) : true);

  const filteredTargetIds = targetNodeIds
    ? new Set([...targetNodeIds].filter((id) => isInScope(id)))
    : undefined;
  const relationEndpointIds = new Set<string>();
  if (targetEdgeIds && targetEdgeIds.size > 0) {
    for (const edge of edges) {
      if (!targetEdgeIds.has(edge.id)) {
        continue;
      }
      if (isInScope(edge.from)) {
        relationEndpointIds.add(edge.from);
      }
      if (isInScope(edge.to)) {
        relationEndpointIds.add(edge.to);
      }
    }
  }

  const hasTargetQuery = targetNodeIds !== undefined || targetEdgeIds !== undefined;
  const seedIds = new Set<string>([
    ...(filteredTargetIds ? [...filteredTargetIds] : []),
    ...relationEndpointIds,
  ]);
  const targetClosureIds = new Set<string>();
  if (hasTargetQuery) {
    for (const id of seedIds) {
      let currentId: string | undefined = id;
      while (currentId && currentId !== tree.rootId && currentId !== scopeBoundaryId) {
        targetClosureIds.add(currentId);
        currentId = tree.byId.get(currentId)?.parentId;
      }
    }
  }

  const includedNodeIds = new Set<string>();
  const revealById = new Map<string, RevealMetadata>();

  const markVisible = (node: TNode, options?: { preservedByExpansion?: boolean }): boolean => {
    const isTarget = filteredTargetIds?.has(node.id) ?? false;
    const isRelationEndpoint = relationEndpointIds.has(node.id);
    const inTargetClosure = targetClosureIds.has(node.id);
    const preservedByExpansion = options?.preservedByExpansion ?? false;

    if (hasTargetQuery && !inTargetClosure && !preservedByExpansion) {
      return false;
    }

    const reveal: RevealMetadata = {
      isTarget,
      isAncestorContext: hasTargetQuery && inTargetClosure && !isTarget && !isRelationEndpoint,
      isRelationEndpoint,
      isPreservedByExpansion: preservedByExpansion,
      hasTargetInSubtree: isTarget || isRelationEndpoint,
    };
    includedNodeIds.add(node.id);
    revealById.set(node.id, reveal);

    const isExpanded = fullyExpanded || Boolean(expanded?.[node.id]);
    const canTraverseChildren =
      fullyExpanded || isExpanded || (forceExpandToTargets && hasTargetQuery && inTargetClosure);
    if (!canTraverseChildren) {
      return true;
    }

    for (const child of node.children) {
      if (!hasTargetQuery) {
        if (markVisible(child)) {
          const childReveal = revealById.get(child.id);
          if (childReveal?.hasTargetInSubtree) {
            reveal.hasTargetInSubtree = true;
          }
        }
        continue;
      }

      const childInTargetClosure = targetClosureIds.has(child.id);
      const childPreservedByExpansion =
        preserveExpandedBranches && isExpanded && !childInTargetClosure;
      if (!childInTargetClosure && !childPreservedByExpansion) {
        continue;
      }
      if (
        markVisible(child, {
          preservedByExpansion: childPreservedByExpansion,
        })
      ) {
        const childReveal = revealById.get(child.id);
        if (childReveal?.hasTargetInSubtree) {
          reveal.hasTargetInSubtree = true;
        }
      }
    }

    return true;
  };

  const scopedRootChildren =
    scopeBoundaryId === tree.rootId ? tree.root.children : getChildren(tree, scopeBoundaryId);
  if (!hasTargetQuery) {
    for (const child of scopedRootChildren) {
      markVisible(child);
    }
    return {
      scopeBoundaryId,
      includedNodeIds,
      revealById,
    };
  }

  if (seedIds.size === 0) {
    return {
      scopeBoundaryId,
      includedNodeIds,
      revealById,
    };
  }

  for (const child of scopedRootChildren) {
    if (!targetClosureIds.has(child.id)) {
      continue;
    }
    markVisible(child);
  }

  return {
    scopeBoundaryId,
    includedNodeIds,
    revealById,
  };
}

export function buildRevealedTree<
  TNode extends TreeNodeLike<TNode>,
  TOutputNode extends TreeNodeLike<TOutputNode> & { reveal: RevealMetadata },
>(params: BuildRevealedTreeParams<TNode, TOutputNode>): CanonicalTree<TOutputNode> {
  const { tree, cloneRoot, cloneNode } = params;
  const annotations = resolveRevealAnnotations({
    tree,
    expanded: params.expanded,
    scopeRootId: params.scopeRootId,
    targetNodeIds: params.targetNodeIds,
    targetEdgeIds: params.targetEdgeIds,
    edges: params.edges,
    forceExpandToTargets: params.forceExpandToTargets,
    preserveExpandedBranches: params.preserveExpandedBranches,
  });

  const byId = new Map<string, TOutputNode>();
  const root = cloneRoot(tree.root, EMPTY_REVEAL);
  root.children = [];
  byId.set(tree.rootId, root);

  const cloneVisible = (node: TNode, parentId: string): TOutputNode | undefined => {
    if (!annotations.includedNodeIds.has(node.id)) {
      return undefined;
    }
    const reveal = annotations.revealById.get(node.id) ?? EMPTY_REVEAL;
    const clone = cloneNode(node, parentId, reveal);
    clone.children = [];
    byId.set(clone.id, clone);
    for (const child of node.children) {
      const childClone = cloneVisible(child, clone.id);
      if (childClone) {
        clone.children.push(childClone);
      }
    }
    return clone;
  };

  const projectionRoots =
    annotations.scopeBoundaryId === tree.rootId
      ? tree.root.children
      : getChildren(tree, annotations.scopeBoundaryId);
  for (const child of projectionRoots) {
    const clone = cloneVisible(child, tree.rootId);
    if (clone) {
      root.children.push(clone);
    }
  }

  return indexTree({
    rootId: tree.rootId,
    byId,
  });
}

export function buildRevealedEntityTree(params: BuildRevealedEntityTreeParams): RevealedEntityTree {
  const {
    tree,
    expanded,
    scopeRootId,
    targetEntityIds,
    targetRelationIds,
    relations = [],
    forceExpandToTargets = false,
    preserveExpandedBranches = false,
  } = params;

  return buildRevealedTree({
    tree,
    expanded,
    scopeRootId,
    targetNodeIds: targetEntityIds,
    targetEdgeIds: targetRelationIds,
    edges: relations.map((relation) => ({
      id: relation.id,
      from: relation.from,
      to: relation.to,
    })),
    forceExpandToTargets,
    preserveExpandedBranches,
    cloneRoot: (node) => ({
      ...node,
      children: [],
      reveal: EMPTY_REVEAL,
    }),
    cloneNode: (node, parentId, reveal) => ({
      ...node,
      parentId,
      children: [],
      reveal,
    }),
  });
}

export const isSemanticRootId = (id: string) => id === ROOT_ID;
