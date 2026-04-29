import type { GraphModel } from '../rendering/graph/graph-model';

export interface CanonicalDiagramStructureQueries {
  getChildren: (rootId: string) => Array<{ id: string }>;
  getDescendantParentIds: (rootId: string, includeRoot?: boolean) => string[];
}

export const buildCanonicalDiagramStructureQueries = (
  graph: GraphModel,
): CanonicalDiagramStructureQueries => ({
  getChildren: (rootId) => graph.childrenByParent.get(rootId) ?? [],
  getDescendantParentIds: (rootId, includeRoot = false) => {
    const result: string[] = [];
    const stack = includeRoot
      ? [rootId]
      : (graph.childrenByParent.get(rootId) ?? []).map((child) => child.id);
    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId) continue;
      const children = graph.childrenByParent.get(currentId) ?? [];
      if (children.length === 0) {
        continue;
      }
      result.push(currentId);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (!child) continue;
        stack.push(child.id);
      }
    }
    return result;
  },
});
