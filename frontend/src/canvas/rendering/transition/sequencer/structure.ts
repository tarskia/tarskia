import type { CompiledDiagramEdge } from '../../../../semantic';
import type { LayoutTree } from '../../layout/tree-traverser';
import { buildStructuralEdgeDiffs } from './edges';
import type {
  StructuralChildVisibilityDiff,
  StructuralNodeDiff,
  StructuralTransitionDiff,
} from './types';
import { buildDepthMap } from './utils';

const getNodeDepth = (params: {
  id: string;
  direction: 'in' | 'out';
  fromDepths: Map<string, number>;
  toDepths: Map<string, number>;
}) => {
  const { id, direction, fromDepths, toDepths } = params;
  if (direction === 'out') {
    return fromDepths.get(id) ?? toDepths.get(id) ?? 0;
  }
  return toDepths.get(id) ?? fromDepths.get(id) ?? 0;
};

export function buildStructuralTransitionDiff(params: {
  direction: 'in' | 'out';
  fromTree: LayoutTree;
  toTree: LayoutTree;
  fromEdges: CompiledDiagramEdge[];
  toEdges: CompiledDiagramEdge[];
}): StructuralTransitionDiff {
  const { direction, fromTree, toTree, fromEdges, toEdges } = params;
  const fromDepths = buildDepthMap(fromTree);
  const toDepths = buildDepthMap(toTree);

  const fromIds = new Set<string>(fromTree.byId.keys());
  const toIds = new Set<string>(toTree.byId.keys());
  fromIds.delete(fromTree.rootId);
  toIds.delete(toTree.rootId);

  const allIds = new Set<string>([...fromIds, ...toIds]);
  const nodeDiffs = new Map<string, StructuralNodeDiff>();
  const childVisibilityByParentAndMode = new Map<string, StructuralChildVisibilityDiff>();

  for (const id of allIds) {
    const fromNode = fromTree.byId.get(id);
    const toNode = toTree.byId.get(id);
    const correspondence = !fromNode ? 'enter' : !toNode ? 'exit' : ('stable' as const);
    const depth = getNodeDepth({
      id,
      direction,
      fromDepths,
      toDepths,
    });
    nodeDiffs.set(id, {
      id,
      correspondence,
      depth,
      fromDepth: fromDepths.get(id),
      toDepth: toDepths.get(id),
      fromParentId: fromNode?.parentId,
      toParentId: toNode?.parentId,
    });

    if (correspondence === 'stable') {
      continue;
    }
    const parentId = correspondence === 'enter' ? toNode?.parentId : fromNode?.parentId;
    if (!parentId || parentId === fromTree.rootId || parentId === toTree.rootId) {
      continue;
    }
    const mode = correspondence === 'enter' ? 'in' : 'out';
    const key = `${parentId}:${mode}`;
    const existing = childVisibilityByParentAndMode.get(key);
    if (existing) {
      existing.childIds.push(id);
      continue;
    }
    childVisibilityByParentAndMode.set(key, {
      parentId,
      mode,
      childIds: [id],
    });
  }

  return {
    rootIds: {
      from: fromTree.rootId,
      to: toTree.rootId,
    },
    nodeDiffs,
    childVisibilityDiffs: [...childVisibilityByParentAndMode.values()],
    edgeDiffs: buildStructuralEdgeDiffs({
      fromEdges,
      toEdges,
    }),
  };
}
