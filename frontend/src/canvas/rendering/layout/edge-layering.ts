import type { EdgePlan } from '../transition/sequencer/types';
import type { ComponentTree } from '../tree/scene-tree';

export interface RoutedEdgePlan extends EdgePlan {
  ownerId: string;
  branchNodeIds: string[];
}

export interface EdgeLayeringPlan {
  localByOwner: Map<string, EdgePlan[]>;
  routed: RoutedEdgePlan[];
}

const getAncestorChain = (tree: ComponentTree, nodeId: string) => {
  const chain: string[] = [];
  let current: string | undefined = nodeId;
  while (current) {
    chain.push(current);
    current = tree.byId.get(current)?.parentId;
  }
  chain.push(tree.rootId);
  return chain;
};

const getCommonAncestor = (tree: ComponentTree, a: string, b: string) => {
  const aChain = getAncestorChain(tree, a);
  const aSet = new Set(aChain);
  const bChain = getAncestorChain(tree, b);
  for (const id of bChain) {
    if (aSet.has(id)) return id;
  }
  return tree.rootId;
};

const getBranchNodeIds = (tree: ComponentTree, source: string, target: string) => {
  const branch = new Set<string>();
  const addChain = (nodeId: string) => {
    let current: string | undefined = nodeId;
    while (current) {
      if (current !== tree.rootId) {
        branch.add(current);
      }
      current = tree.byId.get(current)?.parentId;
    }
  };
  addChain(source);
  addChain(target);
  return [...branch];
};

export function buildEdgeLayeringPlan(params: {
  tree: ComponentTree;
  edgePlans: EdgePlan[];
  visibleIds: Set<string>;
}): EdgeLayeringPlan {
  const { tree, edgePlans, visibleIds } = params;
  const localByOwner = new Map<string, EdgePlan[]>();
  const routed: RoutedEdgePlan[] = [];

  for (const plan of edgePlans) {
    // Visibility is entity-driven. Edges render iff both endpoints are visible;
    // relation tags are metadata only and do not gate edge visibility yet.
    if (!visibleIds.has(plan.sourceId) || !visibleIds.has(plan.targetId)) {
      continue;
    }

    const ownerId = getCommonAncestor(tree, plan.sourceId, plan.targetId);
    const sourceParent = tree.byId.get(plan.sourceId)?.parentId;
    const targetParent = tree.byId.get(plan.targetId)?.parentId;
    const ownerChildren = ownerId === tree.rootId ? [] : (tree.childrenByParent.get(ownerId) ?? []);
    const canRenderLocal =
      ownerId !== tree.rootId &&
      ownerId !== plan.sourceId &&
      ownerId !== plan.targetId &&
      visibleIds.has(ownerId) &&
      ownerChildren.length > 0 &&
      sourceParent === ownerId &&
      targetParent === ownerId;

    if (canRenderLocal) {
      const list = localByOwner.get(ownerId) ?? [];
      list.push(plan);
      localByOwner.set(ownerId, list);
      continue;
    }

    routed.push({
      ...plan,
      ownerId,
      branchNodeIds: getBranchNodeIds(tree, plan.sourceId, plan.targetId),
    });
  }

  return { localByOwner, routed };
}
