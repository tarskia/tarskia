import {
  type CanonicalTree,
  type DiagramViewNodeControls,
  type Entity,
  indexTree,
  type TreeNodeLike,
} from '@tarskia/diagram-semantics';

/**
 * Layout owns geometry only; immutable semantic nodes are shared by reference.
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

/** One shared prototype keeps property access stable across every geometry record. */
export class LayoutGeometryNode<TNode extends LayoutTreeSourceNode<TNode>> implements LayoutNode {
  readonly semanticNode: TNode;
  children: LayoutNode[] = [];
  baseSize = { width: 0, height: 0 };
  size = { width: 0, height: 0 };
  position?: { x: number; y: number };
  layoutMode?: 'list' | 'graph';
  listShowType?: boolean;
  contentOccluders?: LayoutNodeContentOccluder[];
  summaryLabel?: string;

  constructor(semanticNode: TNode) {
    this.semanticNode = semanticNode;
  }
  get id() {
    return this.semanticNode.id;
  }
  get entity() {
    return this.semanticNode.entity;
  }
  get parentId() {
    return this.semanticNode.parentId;
  }
  get hasChildren() {
    return this.semanticNode.hasDiagramChildren ?? this.semanticNode.hasChildren ?? false;
  }
  get isListContainer() {
    return this.semanticNode.isListContainer;
  }
  get diagramChildCount() {
    return this.semanticNode.diagramChildCount;
  }
  get diagramChildTypeCounts() {
    return this.semanticNode.diagramChildTypeCounts;
  }
  get focusScaffoldDepth() {
    return this.semanticNode.view?.focusChainDepth ?? this.semanticNode.focusScaffoldDepth;
  }
  get controls() {
    return this.semanticNode.view?.controls ?? this.semanticNode.controls;
  }
}

export function createLayoutGeometry<TNode extends LayoutTreeSourceNode<TNode>>(params: {
  tree: CanonicalTree<TNode>;
}): LayoutTree {
  const { tree } = params;
  const byId = new Map<string, LayoutNode>();

  // Geometry records reference the immutable compiled view node without copying its fields.
  // There is no second entity/view tree: layout owns only sizing and placement.
  const geometryFor = (node: TNode): LayoutNode => {
    const existing = byId.get(node.id);
    if (existing) return existing;
    const geometry = new LayoutGeometryNode(node);
    byId.set(node.id, geometry);
    geometry.children = node.children.map(geometryFor);
    return geometry;
  };

  geometryFor(tree.root);
  return indexTree({ rootId: tree.rootId, byId });
}
