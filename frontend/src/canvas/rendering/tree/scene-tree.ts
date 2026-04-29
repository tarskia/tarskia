import type { Entity } from '../../../model/types';
import {
  type CanonicalTree,
  type DiagramViewNodeControls,
  indexTree,
  type RevealMetadata,
  type TreeNodeLike,
} from '../../../semantic';

/**
 * Canvas owns scene/layout adaptation only.
 * Semantic hierarchy and reveal decisions come from `src/semantic/tree`.
 */
export interface SceneNodeContentOccluder {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneNode {
  id: string;
  entity: Entity;
  parentId?: string;
  children: SceneNode[];
  hasChildren?: boolean;
  diagramChildCount?: number;
  diagramChildTypeCounts?: Record<string, number>;
  reveal?: RevealMetadata;
  focusScaffoldDepth?: number;
  controls?: DiagramViewNodeControls;
  summaryLabel?: string;
  baseSize: { width: number; height: number };
  size: { width: number; height: number };
  position?: { x: number; y: number };
  computedChildPositions?: Record<string, { x: number; y: number }>;
  layoutMode?: 'list' | 'graph';
  listShowType?: boolean;
  contentOccluders?: SceneNodeContentOccluder[];
}

export type SceneTree = CanonicalTree<SceneNode>;
export type ComponentNode = SceneNode;
export type ComponentTree = SceneTree;

interface SceneTreeSourceNode<TNode> extends TreeNodeLike<TNode> {
  entity: Entity;
  hasDiagramChildren?: boolean;
  hasChildren?: boolean;
  diagramChildCount?: number;
  diagramChildTypeCounts?: Record<string, number>;
  reveal?: RevealMetadata;
  focusScaffoldDepth?: number;
  controls?: DiagramViewNodeControls;
  view?: {
    reveal?: RevealMetadata;
    focusChainDepth?: number;
    controls?: DiagramViewNodeControls;
  };
}

export function buildSceneTree<TNode extends SceneTreeSourceNode<TNode>>(params: {
  tree: CanonicalTree<TNode>;
}): SceneTree {
  const { tree } = params;
  const byId = new Map<string, SceneNode>();

  const clone = (node: TNode, parentId?: string): SceneNode => {
    const reveal = node.view?.reveal ?? node.reveal;
    const focusScaffoldDepth = node.view?.focusChainDepth ?? node.focusScaffoldDepth;
    const sceneNode: SceneNode = {
      id: node.id,
      entity: node.entity,
      parentId,
      children: [],
      hasChildren: node.hasDiagramChildren ?? node.hasChildren ?? false,
      diagramChildCount: node.diagramChildCount,
      diagramChildTypeCounts: node.diagramChildTypeCounts,
      reveal,
      focusScaffoldDepth,
      controls: node.view?.controls ?? node.controls,
      baseSize: { width: 0, height: 0 },
      size: { width: 0, height: 0 },
    };
    byId.set(sceneNode.id, sceneNode);
    for (const child of node.children) {
      sceneNode.children.push(clone(child, node.id));
    }
    return sceneNode;
  };

  clone(tree.root);
  return indexTree({ rootId: tree.rootId, byId });
}
