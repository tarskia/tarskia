import type { LayoutTree } from '../layout/layout-geometry';

export const resolveEndpointChildWithinParent = (
  tree: LayoutTree,
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
