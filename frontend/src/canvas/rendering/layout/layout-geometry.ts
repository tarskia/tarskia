import {
  type CanonicalTree,
  type DiagramViewNodeControls,
  type Entity,
  indexTree,
  type TreeNodeLike,
} from '@tarskia/diagram-semantics';

/**
 * Layout owns geometry only; immutable semantic nodes are shared through prototypes.
 * Semantic hierarchy and reveal decisions come from `src/semantic/tree`.
 */
export interface LayoutNodeContentOccluder {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutNode {
  id: string;
  entity: Entity;
  parentId?: string;
  children: LayoutNode[];
  hasChildren?: boolean;
  isListContainer?: boolean;
  diagramChildCount?: number;
  diagramChildTypeCounts?: Record<string, number>;
  focusScaffoldDepth?: number;
  controls?: DiagramViewNodeControls;
  summaryLabel?: string;
  baseSize: { width: number; height: number };
  size: { width: number; height: number };
  position?: { x: number; y: number };
  layoutMode?: 'list' | 'graph';
  listShowType?: boolean;
  contentOccluders?: LayoutNodeContentOccluder[];
}

export type LayoutTree = CanonicalTree<LayoutNode>;
export type ComponentNode = LayoutNode;
export type ComponentTree = LayoutTree;

interface LayoutTreeSourceNode<TNode> extends TreeNodeLike<TNode> {
  entity: Entity;
  hasDiagramChildren?: boolean;
  hasChildren?: boolean;
  isListContainer?: boolean;
  diagramChildCount?: number;
  diagramChildTypeCounts?: Record<string, number>;
  focusScaffoldDepth?: number;
  controls?: DiagramViewNodeControls;
  view?: {
    focusChainDepth?: number;
    controls?: DiagramViewNodeControls;
  };
}

export function createLayoutGeometry<TNode extends LayoutTreeSourceNode<TNode>>(params: {
  tree: CanonicalTree<TNode>;
}): LayoutTree {
  const { tree } = params;
  const byId = new Map<string, LayoutNode>();

  // Geometry records borrow semantic fields from the immutable compiled view node.
  // There is no second entity/view tree: layout owns only sizing and placement.
  const geometryFor = (node: TNode): LayoutNode => {
    const existing = byId.get(node.id);
    if (existing) return existing;
    const geometry = Object.create(node) as LayoutNode;
    Object.defineProperties(geometry, {
      hasChildren: { get: () => node.hasDiagramChildren ?? node.hasChildren ?? false },
      focusScaffoldDepth: { get: () => node.view?.focusChainDepth ?? node.focusScaffoldDepth },
      controls: { get: () => node.view?.controls ?? node.controls },
      baseSize: { value: { width: 0, height: 0 }, writable: true, enumerable: true },
      size: { value: { width: 0, height: 0 }, writable: true, enumerable: true },
    });
    byId.set(node.id, geometry);
    Object.defineProperty(geometry, 'children', {
      value: node.children.map(geometryFor),
      enumerable: true,
    });
    return geometry;
  };

  geometryFor(tree.root);
  return indexTree({ rootId: tree.rootId, byId });
}
