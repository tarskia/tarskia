import { CORE_CONTAINS_RELATION_ID } from '../model/schema-ids';
import type { DiagramView, Entity, Relation, SchemaModule, SemanticDocument } from '../model/types';
import {
  type CanonicalTree,
  collectSingleChildChainDown,
  getChildren,
  indexTree,
} from '../tree/canonical-tree';
import { buildDiagramViewNodeControls, type DiagramViewNodeControls } from './node-controls';
import {
  type NormalizedDiagramViewState,
  normalizeDiagramViewState,
} from './normalize-diagram-view';
import { type RevealAnnotations, resolveRevealAnnotations } from './reveal-tree';
import {
  buildSemanticIndex,
  ImmutableMap,
  type SemanticIndex,
  type SemanticNodeMetadata,
} from './semantic-index';
import {
  buildSemanticViewWorkingTree,
  EMPTY_CONTROLS,
  type SemanticViewWorkingNode,
  type SemanticViewWorkingTree,
} from './working-tree';

export interface DiagramViewNode {
  id: string;
  entity: Entity;
  parentId?: string;
  children: DiagramViewNode[];
  hasDiagramChildren: boolean;
  /** Multiple leaf children with no relations between them, independent of view expansion. */
  isListContainer?: boolean;
  diagramChildCount?: number;
  diagramChildTypeCounts?: Record<string, number>;
  view: {
    expanded: boolean;
    highlighted: boolean;
    focusChainDepth?: number;
    controls: DiagramViewNodeControls;
  };
}

export interface CompiledDiagramEdge {
  id: string;
  relationId: string;
  sourceId: string;
  targetId: string;
  external?: { end: 'source' | 'target'; entityId: string; displayId: string };
  semanticSourceId?: string;
  semanticTargetId?: string;
  type?: string;
  label?: string;
  state?: 'undecided' | 'none';
  solidOverNodeIds?: string[];
}

export type DiagramViewTree = CanonicalTree<DiagramViewNode>;

export interface CompileDiagramViewTreeParams {
  doc: SemanticDocument;
  schema: SchemaModule;
}

export interface CompiledDiagramViewState {
  /** Highlighted semantic IDs, including nodes outside the current projection. */
  highlightedIds: readonly string[];
  tree: DiagramViewTree;
  edges: CompiledDiagramEdge[];
  /**
   * Back-to-front node paint order for the projected diagram tree, excluding the synthetic root.
   * Rendering hosts can materialize this into concrete z-index values without re-deriving structure.
   */
  nodePaintOrder: string[];
  scopeRootId?: string;
}

export interface EffectiveExpansionResult {
  scopeRootId?: string;
  effectiveExpanded: Record<string, boolean>;
}

export interface RevealAndVisibilityResult extends RevealAnnotations {}

const isRenderableRelationType = (relationTypeId: string | undefined) =>
  relationTypeId !== CORE_CONTAINS_RELATION_ID;

export const buildCompiledDiagramEdgeId = (
  relationId: string,
  sourceId: string,
  targetId: string,
) => `${relationId}:${sourceId}->${targetId}`;

const collectSemanticSolidOverNodeIds = (params: {
  tree: SemanticViewWorkingTree;
  sourceId: string;
  targetId: string;
}) => {
  const collectVisibleAncestors = (entityId: string) => {
    const ids: string[] = [];
    let currentId = params.tree.byId.get(entityId)?.parentId;
    while (currentId) {
      const node = params.tree.byId.get(currentId);
      if (!node) {
        break;
      }
      if (currentId !== params.tree.rootId && node.view.includedInProjection) {
        ids.push(currentId);
      }
      currentId = node.parentId;
    }
    return ids;
  };

  return [
    ...new Set([
      ...collectVisibleAncestors(params.sourceId),
      ...collectVisibleAncestors(params.targetId),
    ]),
  ];
};

const buildDiagramChildTypeCounts = (children: SemanticViewWorkingNode['children']) => {
  const counts: Record<string, number> = {};
  for (const child of children) {
    counts[child.entity.type] = (counts[child.entity.type] ?? 0) + 1;
  }
  return counts;
};

export const applyEffectiveExpansion = (params: {
  tree: SemanticViewWorkingTree;
  normalizedViewState: NormalizedDiagramViewState;
}): EffectiveExpansionResult => {
  const { tree, normalizedViewState } = params;
  const scopeRootId =
    normalizedViewState.view.scopeRootId && tree.byId.has(normalizedViewState.view.scopeRootId)
      ? normalizedViewState.view.scopeRootId
      : undefined;
  const focusEntryChainIds = scopeRootId ? collectSingleChildChainDown(tree, scopeRootId) : [];
  const focusChainDepthById = new Map(focusEntryChainIds.map((id, index) => [id, index] as const));
  const effectiveExpanded = (() => {
    if (!scopeRootId) {
      return { ...normalizedViewState.expanded };
    }
    const forcedExpandedIds = new Set<string>([scopeRootId]);
    for (const id of focusEntryChainIds) {
      if ((tree.byId.get(id)?.children.length ?? 0) > 0) {
        forcedExpandedIds.add(id);
      }
    }
    const nextExpanded: Record<string, boolean> = { ...normalizedViewState.expanded };
    for (const id of forcedExpandedIds) {
      nextExpanded[id] = true;
    }
    return nextExpanded;
  })();

  for (const node of tree.byId.values()) {
    node.view.expanded = node.id === tree.rootId ? true : Boolean(effectiveExpanded[node.id]);
    node.view.highlighted =
      node.id !== tree.rootId && normalizedViewState.highlightedIds.has(node.id);
    node.view.focusChainDepth = focusChainDepthById.get(node.id);
  }

  return {
    scopeRootId,
    effectiveExpanded,
  };
};

export const applyRevealAndVisibility = (params: {
  tree: SemanticViewWorkingTree;
  scopeRootId?: string;
  effectiveExpanded: Record<string, boolean>;
}): RevealAndVisibilityResult => {
  const annotations = resolveRevealAnnotations({
    tree: params.tree,
    expanded: params.effectiveExpanded,
    scopeRootId: params.scopeRootId,
  });

  for (const node of params.tree.byId.values()) {
    node.view.includedInProjection = false;
  }
  for (const nodeId of annotations.includedNodeIds) {
    const node = params.tree.byId.get(nodeId);
    if (!node) {
      continue;
    }
    node.view.includedInProjection = true;
  }

  return annotations;
};

export const applySemanticVisualAugmentation = (params: {
  tree: SemanticViewWorkingTree;
  relations?: Relation[];
  nodeMetadata?: ReadonlyMap<string, SemanticNodeMetadata>;
}): void => {
  const { tree } = params;
  const controlsById = buildDiagramViewNodeControls({ tree });
  for (const node of tree.byId.values()) {
    const metadata = params.nodeMetadata?.get(node.id);
    if (metadata) {
      Object.assign(node.visual, metadata);
    } else {
      node.visual.hasDiagramChildren = node.hasChildren;
      const childIds = new Set(node.children.map((child) => child.id));
      node.visual.isListContainer =
        node.id !== tree.rootId &&
        node.children.length > 1 &&
        node.children.every((child) => !child.hasChildren) &&
        !(params.relations ?? []).some(
          (relation) =>
            isRenderableRelationType(relation.type) &&
            relation.from !== relation.to &&
            childIds.has(relation.from) &&
            childIds.has(relation.to),
        );
      node.visual.diagramChildCount = node.children.length;
      node.visual.diagramChildTypeCounts = buildDiagramChildTypeCounts(node.children);
    }
    node.visual.controls =
      controlsById.get(node.id) ??
      ({
        ...EMPTY_CONTROLS,
        targetId: node.id,
      } satisfies DiagramViewNodeControls);
  }
};

export const projectCompiledDiagramView = (params: {
  tree: SemanticViewWorkingTree;
  scopeBoundaryId: string;
}) => {
  const { tree, scopeBoundaryId } = params;
  const byId = new Map<string, DiagramViewNode>();

  const cloneProjectedNode = (
    node: SemanticViewWorkingNode,
    parentId: string | undefined,
  ): DiagramViewNode => {
    const projectedNode: DiagramViewNode = {
      id: node.id,
      entity: node.entity,
      parentId,
      children: [],
      hasDiagramChildren: node.visual.hasDiagramChildren,
      isListContainer: node.visual.isListContainer,
      diagramChildCount: node.visual.diagramChildCount,
      diagramChildTypeCounts: node.visual.diagramChildTypeCounts,
      view: {
        expanded: node.view.expanded,
        highlighted: node.view.highlighted,
        focusChainDepth: node.view.focusChainDepth,
        controls: node.visual.controls,
      },
    };
    byId.set(projectedNode.id, projectedNode);
    for (const child of node.children) {
      if (!child.view.includedInProjection) {
        continue;
      }
      projectedNode.children.push(cloneProjectedNode(child, projectedNode.id));
    }
    return projectedNode;
  };

  const root: DiagramViewNode = {
    id: tree.root.id,
    entity: tree.root.entity,
    parentId: undefined,
    children: [],
    hasDiagramChildren: tree.root.visual.hasDiagramChildren,
    isListContainer: false,
    diagramChildCount: tree.root.visual.diagramChildCount,
    diagramChildTypeCounts: tree.root.visual.diagramChildTypeCounts,
    view: {
      expanded: true,
      highlighted: false,
      controls: tree.root.visual.controls,
    },
  };
  byId.set(root.id, root);
  const projectionRoots =
    scopeBoundaryId === tree.rootId ? tree.root.children : getChildren(tree, scopeBoundaryId);
  for (const child of projectionRoots) {
    if (!child.view.includedInProjection) {
      continue;
    }
    root.children.push(cloneProjectedNode(child, root.id));
  }

  return indexTree({
    rootId: tree.rootId,
    byId,
  });
};

const buildCompiledDiagramNodePaintOrder = (tree: DiagramViewTree): string[] => {
  const order: string[] = [];
  const visit = (node: DiagramViewNode) => {
    order.push(node.id);
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const child of tree.root.children) {
    visit(child);
  }
  return order;
};

const projectCompiledDiagramEdges = (params: {
  tree: SemanticViewWorkingTree;
  scopeBoundaryId: string;
  relations: Relation[];
  relationDisplayById: ReadonlyMap<string, string | undefined>;
  outsideVisibleIds: Set<string>;
}) => {
  const { tree, scopeBoundaryId, relations, relationDisplayById } = params;
  const resolveVisibleNodeId = (entityId: string): string | null => {
    let currentId: string | undefined = entityId;
    while (currentId) {
      const node = tree.byId.get(currentId);
      if (!node) {
        return null;
      }
      if (node.view.includedInProjection) {
        return currentId === tree.rootId ? null : currentId;
      }
      if (currentId === scopeBoundaryId) {
        return null;
      }
      currentId = node.parentId;
      if (currentId === tree.rootId) {
        return null;
      }
    }
    return null;
  };

  const isInside = (entityId: string) => {
    let node = tree.byId.get(entityId);
    while (node) {
      if (node.id === scopeBoundaryId) return true;
      node = node.parentId ? tree.byId.get(node.parentId) : undefined;
    }
    return false;
  };
  const resolveOutside = (entityId: string): string | undefined => {
    let node = tree.byId.get(entityId);
    while (node && node.id !== tree.rootId) {
      if (params.outsideVisibleIds.has(node.id)) return node.id;
      node = node.parentId ? tree.byId.get(node.parentId) : undefined;
    }
    return undefined;
  };
  const edges: CompiledDiagramEdge[] = [];
  for (const relation of relations) {
    if (!isRenderableRelationType(relation.type)) {
      continue;
    }
    const focused = scopeBoundaryId !== tree.rootId;
    const sourceInside = focused && isInside(relation.from);
    const targetInside = focused && isInside(relation.to);
    const crossing = focused && sourceInside !== targetInside;
    const outsideEntityId = sourceInside ? relation.to : relation.from;
    const displayId = crossing ? resolveOutside(outsideEntityId) : undefined;
    const external: CompiledDiagramEdge['external'] = displayId
      ? { end: sourceInside ? 'target' : 'source', entityId: outsideEntityId, displayId }
      : undefined;
    const resolveInside = (id: string) =>
      crossing && id === scopeBoundaryId ? id : resolveVisibleNodeId(id);
    const sourceId = external?.end === 'source' ? displayId : resolveInside(relation.from);
    const targetId = external?.end === 'target' ? displayId : resolveInside(relation.to);
    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }
    edges.push({
      id: buildCompiledDiagramEdgeId(relation.id, sourceId, targetId),
      relationId: relation.id,
      ...(external ? { external } : {}),
      sourceId,
      targetId,
      semanticSourceId: relation.from,
      semanticTargetId: relation.to,
      type: relation.type,
      label: relationDisplayById.get(relation.id),
      state: relation.state ?? (relation.type ? undefined : 'undecided'),
      solidOverNodeIds: collectSemanticSolidOverNodeIds({
        tree,
        sourceId: relation.from,
        targetId: relation.to,
      }),
    });
  }
  return edges;
};

const EMPTY_VIEW_NODES = {};
const compiledViews = new WeakMap<
  SemanticIndex,
  WeakMap<object, Map<string | undefined, CompiledDiagramViewState>>
>();

export function compileView(
  index: SemanticIndex,
  view: DiagramView | undefined,
): CompiledDiagramViewState {
  let byNodes = compiledViews.get(index);
  if (!byNodes) {
    byNodes = new WeakMap();
    compiledViews.set(index, byNodes);
  }
  const nodesKey = view?.nodesById ?? EMPTY_VIEW_NODES;
  const byScope = byNodes.get(nodesKey) ?? new Map<string | undefined, CompiledDiagramViewState>();
  const cached = byScope.get(view?.scopeRootId);
  if (cached) return cached;
  const normalizedViewState = normalizeDiagramViewState(view);
  const workingTree = buildSemanticViewWorkingTree(index.tree);
  const effectiveExpansion = applyEffectiveExpansion({
    tree: workingTree,
    normalizedViewState,
  });
  const revealAndVisibility = applyRevealAndVisibility({
    tree: workingTree,
    scopeRootId: effectiveExpansion.scopeRootId,
    effectiveExpanded: effectiveExpansion.effectiveExpanded,
  });
  applySemanticVisualAugmentation({
    tree: workingTree,
    nodeMetadata: index.nodeMetadata,
  });
  const projectedTree = projectCompiledDiagramView({
    tree: workingTree,
    scopeBoundaryId: revealAndVisibility.scopeBoundaryId,
  });

  const outsideVisibleIds = effectiveExpansion.scopeRootId
    ? resolveRevealAnnotations({
        tree: index.tree,
        expanded: normalizedViewState.expanded,
      }).includedNodeIds
    : new Set<string>();
  const result = {
    ...(effectiveExpansion.scopeRootId ? { scopeRootId: effectiveExpansion.scopeRootId } : {}),
    highlightedIds: Object.freeze(
      [...normalizedViewState.highlightedIds].filter(
        (id) => index.tree.byId.has(id) && id !== index.tree.rootId,
      ),
    ),
    tree: projectedTree,
    edges: projectCompiledDiagramEdges({
      tree: workingTree,
      scopeBoundaryId: revealAndVisibility.scopeBoundaryId,
      relations: index.renderableRelations,
      relationDisplayById: index.relationDisplayById,
      outsideVisibleIds,
    }),
    nodePaintOrder: buildCompiledDiagramNodePaintOrder(projectedTree),
  };
  for (const node of projectedTree.byId.values()) {
    Object.freeze(node.children);
    Object.freeze(node.view.controls);
    Object.freeze(node.view);
    if (node.diagramChildTypeCounts) Object.freeze(node.diagramChildTypeCounts);
    Object.freeze(node);
  }
  projectedTree.byId = new ImmutableMap(projectedTree.byId);
  projectedTree.childrenByParent = new ImmutableMap(projectedTree.childrenByParent);
  Object.freeze(projectedTree);
  for (const edge of result.edges) {
    if (edge.solidOverNodeIds) Object.freeze(edge.solidOverNodeIds);
    if (edge.external) Object.freeze(edge.external);
    Object.freeze(edge);
  }
  Object.freeze(result.edges);
  Object.freeze(result.nodePaintOrder);
  Object.freeze(result);
  byScope.set(view?.scopeRootId, result);
  if (byScope.size > 32) byScope.delete(byScope.keys().next().value);
  byNodes.set(nodesKey, byScope);
  return result;
}

export function compileDiagramViewState(
  params: CompileDiagramViewTreeParams,
): CompiledDiagramViewState {
  // Legacy callers may mutate documents in place. Only explicit SemanticIndex callers
  // opt into the immutable-content identity contract and cross-call compilation cache.
  return compileView(
    buildSemanticIndex({ ...params.doc, entities: [...params.doc.entities] }, params.schema),
    params.doc.view,
  );
}

export function compileDiagramViewTree(params: CompileDiagramViewTreeParams): DiagramViewTree {
  return compileDiagramViewState(params).tree;
}

export { getDiagramViewExpandedMap } from './normalize-diagram-view';
