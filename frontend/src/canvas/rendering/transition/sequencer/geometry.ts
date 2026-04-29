import type { LayoutTree } from '../../layout/tree-traverser';
import type { StructuralTransitionDiff, TransitionGeometryAdvisory } from './types';
import { toAbsolutePositions } from './utils';

const getLocalPosition = (tree: LayoutTree, id: string) =>
  tree.byId.get(id)?.position ?? { x: 0, y: 0 };

export function buildTransitionGeometryAdvisory(params: {
  fromTree: LayoutTree;
  toTree: LayoutTree;
  structure: StructuralTransitionDiff;
}): TransitionGeometryAdvisory {
  const { fromTree, toTree, structure } = params;
  const basePositions = toAbsolutePositions(fromTree);
  const targetPositions = toAbsolutePositions(toTree);
  const nodeGeometry = new Map<
    string,
    TransitionGeometryAdvisory['nodeGeometry'] extends Map<string, infer TValue> ? TValue : never
  >();

  for (const diff of structure.nodeDiffs.values()) {
    if (diff.correspondence !== 'stable') {
      continue;
    }
    const fromNode = fromTree.byId.get(diff.id);
    const toNode = toTree.byId.get(diff.id);
    if (!fromNode || !toNode) {
      continue;
    }
    const fromPos = basePositions[diff.id];
    const toPos = targetPositions[diff.id];
    const fromLocalPos = getLocalPosition(fromTree, diff.id);
    const toLocalPos = getLocalPosition(toTree, diff.id);
    nodeGeometry.set(diff.id, {
      id: diff.id,
      depth: diff.depth,
      parentId: toNode.parentId ?? fromNode.parentId,
      localMoveX: fromLocalPos.x !== toLocalPos.x,
      localMoveY: fromLocalPos.y !== toLocalPos.y,
      absoluteMoveX: Boolean(fromPos && toPos && fromPos.x !== toPos.x),
      absoluteMoveY: Boolean(fromPos && toPos && fromPos.y !== toPos.y),
      shrinkX: toNode.size.width < fromNode.size.width,
      shrinkY: toNode.size.height < fromNode.size.height,
      growX: toNode.size.width > fromNode.size.width,
      growY: toNode.size.height > fromNode.size.height,
    });
  }

  const resolveInheritedMoveParentId = (id: string, axis: 'x' | 'y') => {
    let parentId = nodeGeometry.get(id)?.parentId;
    while (parentId && parentId !== structure.rootIds.from && parentId !== structure.rootIds.to) {
      const parentGeometry = nodeGeometry.get(parentId);
      if (
        parentGeometry &&
        (axis === 'x' ? parentGeometry.localMoveX : parentGeometry.localMoveY)
      ) {
        return parentId;
      }
      parentId = parentGeometry?.parentId;
    }
    return undefined;
  };

  for (const geometry of nodeGeometry.values()) {
    if (!geometry.localMoveX && geometry.absoluteMoveX) {
      geometry.inheritedMoveXParentId = resolveInheritedMoveParentId(geometry.id, 'x');
    }
    if (!geometry.localMoveY && geometry.absoluteMoveY) {
      geometry.inheritedMoveYParentId = resolveInheritedMoveParentId(geometry.id, 'y');
    }
  }

  return {
    basePositions,
    targetPositions,
    nodeGeometry,
  };
}
