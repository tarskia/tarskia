/**
 * Generic tree indexing/traversal helpers for semantic and view trees.
 * These helpers are intentionally UI-agnostic so search, diff, and canvas code
 * can share the same hierarchy primitives without importing from canvas internals.
 */
export interface TreeNodeLike<TNode> {
  id: string;
  parentId?: string;
  children: TNode[];
}

export interface CanonicalTree<TNode extends TreeNodeLike<TNode>> {
  rootId: string;
  root: TNode;
  byId: Map<string, TNode>;
  childrenByParent: Map<string, TNode[]>;
}

export function buildChildrenByParent<TNode extends TreeNodeLike<TNode>>(
  byId: Map<string, TNode>,
): Map<string, TNode[]> {
  const childrenByParent = new Map<string, TNode[]>();
  for (const node of byId.values()) {
    if (node.children.length > 0) {
      childrenByParent.set(node.id, node.children);
    }
  }
  return childrenByParent;
}

export function indexTree<TNode extends TreeNodeLike<TNode>>(params: {
  rootId: string;
  byId: Map<string, TNode>;
}): CanonicalTree<TNode> {
  const { rootId, byId } = params;
  const root = byId.get(rootId);
  if (!root) {
    throw new Error(`Tree root "${rootId}" not found`);
  }
  return {
    rootId,
    root,
    byId,
    childrenByParent: buildChildrenByParent(byId),
  };
}

export function getChildren<TNode extends TreeNodeLike<TNode>>(
  tree: CanonicalTree<TNode>,
  parentId: string,
): TNode[] {
  return tree.childrenByParent.get(parentId) ?? [];
}

export function getAncestors<TNode extends TreeNodeLike<TNode>>(
  tree: CanonicalTree<TNode>,
  nodeId: string,
  options?: { includeSelf?: boolean },
): string[] {
  const ancestors: string[] = [];
  let currentId: string | undefined = options?.includeSelf
    ? nodeId
    : tree.byId.get(nodeId)?.parentId;
  const visited = new Set<string>(options?.includeSelf ? [] : [nodeId]);
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    ancestors.push(currentId);
    currentId = tree.byId.get(currentId)?.parentId;
  }
  return ancestors;
}

export function collectDescendantIds<TNode extends TreeNodeLike<TNode>>(
  tree: CanonicalTree<TNode>,
  rootId: string,
  options?: { includeRoot?: boolean },
): Set<string> {
  const includeRoot = options?.includeRoot ?? true;
  const ids = new Set<string>();
  const root = tree.byId.get(rootId);
  if (!root) return ids;

  const stack: TNode[] = [root];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);
    if (includeRoot || node.id !== rootId) {
      ids.add(node.id);
    }
    for (const child of node.children) {
      stack.push(child);
    }
  }

  return ids;
}

export function collectDescendantParentIds<TNode extends TreeNodeLike<TNode>>(
  tree: CanonicalTree<TNode>,
  rootId: string,
  options?: { includeRoot?: boolean },
): string[] {
  const includeRoot = options?.includeRoot ?? false;
  const ids: string[] = [];
  const root = tree.byId.get(rootId);
  if (!root) return ids;

  const stack: TNode[] = [root];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);
    if (node.children.length > 0 && (includeRoot || node.id !== rootId)) {
      ids.push(node.id);
    }
    for (const child of node.children) {
      stack.push(child);
    }
  }

  return ids;
}

export function getSingleChildChainTop<TNode extends TreeNodeLike<TNode>>(
  tree: CanonicalTree<TNode>,
  startId: string,
): string {
  let current = startId;
  const visited = new Set<string>([startId]);
  while (true) {
    const parentId = tree.byId.get(current)?.parentId;
    if (!parentId || parentId === tree.rootId || visited.has(parentId)) {
      return current;
    }
    const siblings = getChildren(tree, parentId);
    if (siblings.length !== 1 || siblings[0]?.id !== current) {
      return current;
    }
    visited.add(parentId);
    current = parentId;
  }
}

export function collectSingleChildChainDown<TNode extends TreeNodeLike<TNode>>(
  tree: CanonicalTree<TNode>,
  startId: string,
): string[] {
  const ids: string[] = [];
  let currentId = startId;
  const visited = new Set<string>([startId]);
  while (true) {
    const children = getChildren(tree, currentId);
    if (children.length !== 1) {
      return ids;
    }
    const child = children[0];
    if (!child || visited.has(child.id)) {
      return ids;
    }
    visited.add(child.id);
    ids.push(child.id);
    currentId = child.id;
  }
}

export function traverseTree<TNode extends TreeNodeLike<TNode>>(params: {
  tree: CanonicalTree<TNode>;
  rootId: string;
  getChildren: (parentId: string) => TNode[];
  visit: (parentId: string, children: TNode[]) => void;
}): void {
  const { tree, rootId, getChildren, visit } = params;
  const stack: string[] = [rootId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const parentId = stack.pop();
    if (!parentId || visited.has(parentId)) continue;
    visited.add(parentId);
    const children = getChildren(parentId);
    visit(parentId, children);
    for (const child of children) {
      if (tree.byId.has(child.id)) {
        stack.push(child.id);
      }
    }
  }
}
