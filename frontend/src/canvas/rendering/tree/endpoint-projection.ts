import type { SceneTree } from './scene-tree';

export const resolveEndpointChildWithinParent = (
  tree: SceneTree,
  parentId: string,
  childSet: Set<string>,
  endpointId: string,
): string | null => {
  let currentId: string | undefined = endpointId;
  while (currentId && currentId !== tree.rootId) {
    if (currentId === parentId) {
      return null;
    }
    const parentNodeId = tree.byId.get(currentId)?.parentId;
    if (parentNodeId === parentId) {
      return childSet.has(currentId) ? currentId : null;
    }
    currentId = parentNodeId;
  }
  return null;
};
