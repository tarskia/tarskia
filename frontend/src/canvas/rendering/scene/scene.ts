import type { SchemaModule, SemanticDocument } from '../../../semantic';
import type { EdgePlan } from '../transition/sequencer/types';
import type { SceneTree } from '../tree/scene-tree';
import type { ResolvedVisualEdge } from '../visual/edge-visuals';
import type { ResolvedNodeVisual } from '../visual/node-visuals';

export interface SceneEdge {
  id: string;
  relationId: string;
  relationIds?: string[];
  semanticSourceId?: string;
  semanticTargetId?: string;
  type?: string;
  label?: string;
  state?: 'undecided' | 'none';
  sourceId: string;
  targetId: string;
  opacity?: number;
}

export interface RoutedSceneEdge extends SceneEdge {
  solidOverNodeIds: string[];
}

export interface EdgeRoutingIndex {
  commonAncestorByEdgeId: Map<string, string>;
  localByScope: Map<string, SceneEdge[]>;
  routed: RoutedSceneEdge[];
}

export interface CanvasScene {
  doc: SemanticDocument;
  schema: SchemaModule;
  tree: SceneTree;
  edges: ResolvedVisualEdge[];
  nodeVisuals: Map<string, ResolvedNodeVisual>;
  visibleIds: Set<string>;
  absolutePositions: Record<string, { x: number; y: number }>;
  zIndexById: Map<string, number>;
  layoutMeta: {
    level: number;
  };
}

const getAncestorChain = (tree: SceneTree, nodeId: string) => {
  const chain: string[] = [];
  let current: string | undefined = nodeId;
  while (current) {
    chain.push(current);
    current = tree.byId.get(current)?.parentId;
  }
  chain.push(tree.rootId);
  return chain;
};

const getCommonAncestor = (tree: SceneTree, a: string, b: string) => {
  const aChain = getAncestorChain(tree, a);
  const aSet = new Set(aChain);
  const bChain = getAncestorChain(tree, b);
  for (const id of bChain) {
    if (aSet.has(id)) return id;
  }
  return tree.rootId;
};

const getSolidOverNodeIds = (tree: SceneTree, source: string, target: string) => {
  const solidOverNodeIds = new Set<string>();
  const addAncestorChain = (nodeId: string) => {
    let current = tree.byId.get(nodeId)?.parentId;
    while (current) {
      if (current !== tree.rootId) {
        solidOverNodeIds.add(current);
      }
      current = tree.byId.get(current)?.parentId;
    }
  };
  addAncestorChain(source);
  addAncestorChain(target);
  return [...solidOverNodeIds];
};

export function buildAbsolutePositions(tree: SceneTree): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const queue: Array<{ id: string; abs: { x: number; y: number } }> = [];
  for (const child of tree.root.children) {
    const pos = child.position ?? { x: 0, y: 0 };
    positions[child.id] = pos;
    queue.push({ id: child.id, abs: pos });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const node = tree.byId.get(current.id);
    if (!node) continue;
    for (const child of node.children) {
      const rel = child.position ?? { x: 0, y: 0 };
      const next = { x: current.abs.x + rel.x, y: current.abs.y + rel.y };
      positions[child.id] = next;
      queue.push({ id: child.id, abs: next });
    }
  }
  return positions;
}

export function buildSceneZIndex(nodePaintOrder: readonly string[]): Map<string, number> {
  return new Map(nodePaintOrder.map((nodeId, index) => [nodeId, index + 1] as const));
}

export function buildEdgeRoutingIndex(params: {
  tree: SceneTree;
  edgePlans: EdgePlan[];
}): EdgeRoutingIndex {
  const { tree, edgePlans } = params;
  const commonAncestorByEdgeId = new Map<string, string>();
  const localByScope = new Map<string, SceneEdge[]>();
  const routed: RoutedSceneEdge[] = [];

  for (const plan of edgePlans) {
    const commonAncestor = getCommonAncestor(tree, plan.sourceId, plan.targetId);
    commonAncestorByEdgeId.set(plan.id, commonAncestor);
    const sourceParent = tree.byId.get(plan.sourceId)?.parentId;
    const targetParent = tree.byId.get(plan.targetId)?.parentId;
    const scopeChildren =
      commonAncestor === tree.rootId ? [] : (tree.childrenByParent.get(commonAncestor) ?? []);
    const canRenderLocal =
      commonAncestor !== tree.rootId &&
      commonAncestor !== plan.sourceId &&
      commonAncestor !== plan.targetId &&
      scopeChildren.length > 0 &&
      sourceParent === commonAncestor &&
      targetParent === commonAncestor;
    if (canRenderLocal) {
      const edge: SceneEdge = {
        id: plan.id,
        relationId: plan.relationId,
        relationIds: plan.relationIds,
        semanticSourceId: plan.semanticSourceId,
        semanticTargetId: plan.semanticTargetId,
        type: plan.type,
        label: plan.label,
        state: plan.state,
        sourceId: plan.sourceId,
        targetId: plan.targetId,
      };
      const list = localByScope.get(commonAncestor) ?? [];
      list.push(edge);
      localByScope.set(commonAncestor, list);
      continue;
    }
    const edge: SceneEdge = {
      id: plan.id,
      relationId: plan.relationId,
      relationIds: plan.relationIds,
      semanticSourceId: plan.semanticSourceId,
      semanticTargetId: plan.semanticTargetId,
      type: plan.type,
      label: plan.label,
      state: plan.state,
      sourceId: plan.sourceId,
      targetId: plan.targetId,
    };
    routed.push({
      ...edge,
      solidOverNodeIds:
        plan.solidOverNodeIds && plan.solidOverNodeIds.length > 0
          ? plan.solidOverNodeIds
          : getSolidOverNodeIds(tree, plan.sourceId, plan.targetId),
    });
  }

  return {
    commonAncestorByEdgeId,
    localByScope,
    routed,
  };
}
