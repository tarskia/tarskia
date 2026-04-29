import type { CanonicalTree } from '../tree/canonical-tree';
import { indexTree } from '../tree/canonical-tree';
import type { SemanticEntityTree } from '../tree/entity-tree';
import type { DiagramViewNodeControls } from './node-controls';
import type { RevealMetadata } from './reveal-tree';

export interface SemanticViewWorkingNode {
  id: string;
  entity: SemanticEntityTree['root']['entity'];
  parentId?: string;
  children: SemanticViewWorkingNode[];
  hasChildren: boolean;
  view: {
    expanded: boolean;
    hidden: boolean;
    highlighted: boolean;
    isOnlyChild: boolean;
    focusChainDepth?: number;
    reveal: RevealMetadata;
    includedInProjection: boolean;
  };
  visual: {
    hasDiagramChildren: boolean;
    diagramChildCount?: number;
    diagramChildTypeCounts?: Record<string, number>;
    controls: DiagramViewNodeControls;
  };
}

export type SemanticViewWorkingTree = CanonicalTree<SemanticViewWorkingNode>;

export const EMPTY_REVEAL: RevealMetadata = {
  isTarget: false,
  isAncestorContext: false,
  isRelationEndpoint: false,
  isPreservedByExpansion: false,
  hasTargetInSubtree: false,
};

export const EMPTY_CONTROLS: DiagramViewNodeControls = {
  targetId: '',
  showZoomControls: false,
  canZoomIn: false,
  canZoomOut: false,
  showDetailControls: false,
  canExpandDetails: false,
  canCollapseDetails: false,
  showChildGroupControls: false,
  canExpandChildGroups: false,
  canCollapseChildGroups: false,
};

export const buildSemanticViewWorkingTree = (
  entityTree: SemanticEntityTree,
): SemanticViewWorkingTree => {
  const byId = new Map<string, SemanticViewWorkingNode>();

  const cloneNode = (
    node: SemanticEntityTree['root'],
    parentId: string | undefined,
    siblingCount: number,
  ): SemanticViewWorkingNode => {
    const clone: SemanticViewWorkingNode = {
      id: node.id,
      entity: node.entity,
      parentId,
      children: [],
      hasChildren: node.hasChildren,
      view: {
        expanded: false,
        hidden: false,
        highlighted: false,
        isOnlyChild: siblingCount === 1,
        reveal: EMPTY_REVEAL,
        includedInProjection: false,
      },
      visual: {
        hasDiagramChildren: false,
        controls: {
          ...EMPTY_CONTROLS,
          targetId: node.id,
        },
      },
    };
    byId.set(clone.id, clone);
    const childCount = node.children.length;
    for (const child of node.children) {
      clone.children.push(cloneNode(child, clone.id, childCount));
    }
    return clone;
  };

  cloneNode(entityTree.root, undefined, 0);
  return indexTree({
    rootId: entityTree.rootId,
    byId,
  });
};
