import type { CanonicalTree, TreeNodeLike } from '../tree/canonical-tree';

export interface DiagramViewNodeControls {
  targetId: string;
  showZoomControls: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  showDetailControls: boolean;
  canExpandDetails: boolean;
  canCollapseDetails: boolean;
  showChildGroupControls: boolean;
  canExpandChildGroups: boolean;
  canCollapseChildGroups: boolean;
}

interface SemanticViewNodeLike<TNode extends TreeNodeLike<TNode>> extends TreeNodeLike<TNode> {
  hasChildren: boolean;
  view: {
    expanded: boolean;
    includedInProjection: boolean;
  };
}

interface DetailControlState {
  canExpandDetails: boolean;
  canCollapseDetails: boolean;
}

export const hasChildGroupControlRow = (params: {
  rootExpanded: boolean;
  directChildParentCount: number;
}): boolean => params.rootExpanded && params.directChildParentCount >= 2;

export const hasExpandableDirectChildParents = (
  directChildParentIds: string[],
  expanded: Record<string, boolean>,
): boolean => directChildParentIds.some((childId) => !expanded[childId]);

export const hasCollapsibleDirectChildParents = (
  directChildParentIds: string[],
  expanded: Record<string, boolean>,
): boolean => directChildParentIds.some((childId) => Boolean(expanded[childId]));

const buildDetailControlStateIndex = <TNode extends SemanticViewNodeLike<TNode>>(
  tree: CanonicalTree<TNode>,
): Map<string, DetailControlState> => {
  const detailStateById = new Map<string, DetailControlState>();

  const visit = (node: TNode): DetailControlState => {
    let canExpandDetails = node.hasChildren && !node.view.expanded;
    let canCollapseDetails = node.hasChildren && node.view.expanded;

    for (const child of node.children) {
      const childState = visit(child);
      canExpandDetails ||= childState.canExpandDetails;
      canCollapseDetails ||= childState.canCollapseDetails;
    }

    const detailState = {
      canExpandDetails,
      canCollapseDetails,
    };
    detailStateById.set(node.id, detailState);
    return detailState;
  };

  for (const child of tree.root.children) {
    visit(child);
  }

  return detailStateById;
};

export const buildDiagramViewNodeControls = <TNode extends SemanticViewNodeLike<TNode>>({
  tree,
}: {
  tree: CanonicalTree<TNode>;
}): Map<string, DiagramViewNodeControls> => {
  const detailStateById = buildDetailControlStateIndex(tree);
  const expandedById = Object.fromEntries(
    [...tree.byId.values()].map((entry) => [entry.id, entry.view.expanded] as const),
  );
  const controlsById = new Map<string, DiagramViewNodeControls>();

  for (const [nodeId, node] of tree.byId.entries()) {
    const hasDiagramChildren = node.hasChildren;
    const directChildParentIds = node.children
      .filter((child) => child.view.includedInProjection && child.hasChildren)
      .map((child) => child.id);
    const showChildGroupControls = hasChildGroupControlRow({
      rootExpanded: node.view.expanded,
      directChildParentCount: directChildParentIds.length,
    });
    const detailState = detailStateById.get(nodeId);

    controlsById.set(nodeId, {
      targetId: nodeId,
      showZoomControls: hasDiagramChildren,
      canZoomIn: hasDiagramChildren && !node.view.expanded,
      canZoomOut: hasDiagramChildren && node.view.expanded,
      showDetailControls: hasDiagramChildren,
      canExpandDetails: hasDiagramChildren && (detailState?.canExpandDetails ?? false),
      canCollapseDetails: hasDiagramChildren && (detailState?.canCollapseDetails ?? false),
      showChildGroupControls,
      canExpandChildGroups:
        showChildGroupControls &&
        hasExpandableDirectChildParents(directChildParentIds, expandedById),
      canCollapseChildGroups:
        showChildGroupControls &&
        hasCollapsibleDirectChildParents(directChildParentIds, expandedById),
    });
  }

  return controlsById;
};
