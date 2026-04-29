import {
  CORE_CONTAINS_RELATION_ID,
  FREEFORM_RELATION_TYPE,
  getSchemaObjectLocalId,
} from '../model/schema-ids';
import type { Entity, Relation, SchemaModule, SemanticDocument } from '../model/types';
import {
  type CanonicalTree,
  collectSingleChildChainDown,
  getChildren,
  indexTree,
} from '../tree/canonical-tree';
import { buildEntityTree, type SemanticEntityTree } from '../tree/entity-tree';
import { buildDiagramViewNodeControls, type DiagramViewNodeControls } from './node-controls';
import {
  type NormalizedDiagramViewState,
  normalizeDiagramViewState,
} from './normalize-diagram-view';
import {
  type RevealAnnotations,
  type RevealMetadata,
  resolveRevealAnnotations,
} from './reveal-tree';
import {
  buildSemanticViewWorkingTree,
  EMPTY_CONTROLS,
  EMPTY_REVEAL,
  type SemanticViewWorkingNode,
  type SemanticViewWorkingTree,
} from './working-tree';

export interface DiagramViewNode {
  id: string;
  entity: Entity;
  parentId?: string;
  children: DiagramViewNode[];
  hasDiagramChildren: boolean;
  diagramChildCount?: number;
  diagramChildTypeCounts?: Record<string, number>;
  view: {
    expanded: boolean;
    hidden: boolean;
    highlighted: boolean;
    isOnlyChild: boolean;
    focusChainDepth?: number;
    reveal: RevealMetadata;
    controls: DiagramViewNodeControls;
  };
}

export interface CompiledDiagramEdge {
  id: string;
  relationId: string;
  sourceId: string;
  targetId: string;
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
  entityTree?: SemanticEntityTree;
  targetEntityIds?: Set<string>;
  targetRelationIds?: Set<string>;
  forceRevealTargets?: boolean;
  preserveExpandedBranches?: boolean;
}

export interface CompiledDiagramViewState {
  tree: DiagramViewTree;
  edges: CompiledDiagramEdge[];
  /**
   * Back-to-front node paint order for the projected diagram tree, excluding the synthetic root.
   * Rendering hosts can materialize this into concrete z-index values without re-deriving structure.
   */
  nodePaintOrder: string[];
}

export interface EffectiveExpansionResult {
  scopeRootId?: string;
  effectiveExpanded: Record<string, boolean>;
}

export interface RevealAndVisibilityResult extends RevealAnnotations {}

const isRenderableRelationType = (relationTypeId: string | undefined) =>
  relationTypeId !== CORE_CONTAINS_RELATION_ID;

const resolveRelationDisplayLabel = (
  relation: Relation,
  relationTypeById: Map<string, SchemaModule['relations'][number]>,
) => {
  if (!relation.type) {
    return relation.label;
  }
  if (relation.type === FREEFORM_RELATION_TYPE) {
    return relation.label ?? FREEFORM_RELATION_TYPE;
  }
  const relationType = relationTypeById.get(relation.type);
  return (
    relation.label ??
    relationType?.shortLabel ??
    relationType?.label ??
    getSchemaObjectLocalId(relation.type)
  );
};

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
    node.view.hidden = node.id !== tree.rootId && normalizedViewState.hiddenIds.has(node.id);
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
  targetEntityIds?: Set<string>;
  targetRelationIds?: Set<string>;
  relations?: Relation[];
  forceRevealTargets?: boolean;
  preserveExpandedBranches?: boolean;
}): RevealAndVisibilityResult => {
  const annotations = resolveRevealAnnotations({
    tree: params.tree,
    expanded: params.effectiveExpanded,
    scopeRootId: params.scopeRootId,
    targetNodeIds: params.targetEntityIds,
    targetEdgeIds: params.targetRelationIds,
    edges: (params.relations ?? []).map((relation) => ({
      id: relation.id,
      from: relation.from,
      to: relation.to,
    })),
    forceExpandToTargets: params.forceRevealTargets,
    preserveExpandedBranches: params.preserveExpandedBranches,
  });

  for (const node of params.tree.byId.values()) {
    node.view.reveal = EMPTY_REVEAL;
    node.view.includedInProjection = false;
  }
  for (const nodeId of annotations.includedNodeIds) {
    const node = params.tree.byId.get(nodeId);
    if (!node) {
      continue;
    }
    node.view.reveal = annotations.revealById.get(nodeId) ?? EMPTY_REVEAL;
    node.view.includedInProjection = true;
  }

  return annotations;
};

export const applySemanticVisualAugmentation = (params: {
  tree: SemanticViewWorkingTree;
}): void => {
  const { tree } = params;
  const controlsById = buildDiagramViewNodeControls({ tree });
  for (const node of tree.byId.values()) {
    node.visual.hasDiagramChildren = node.hasChildren;
    node.visual.diagramChildCount = node.children.length;
    node.visual.diagramChildTypeCounts = buildDiagramChildTypeCounts(node.children);
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
      diagramChildCount: node.visual.diagramChildCount,
      diagramChildTypeCounts: node.visual.diagramChildTypeCounts,
      view: {
        expanded: node.view.expanded,
        hidden: node.view.hidden,
        highlighted: node.view.highlighted,
        isOnlyChild: node.view.isOnlyChild,
        focusChainDepth: node.view.focusChainDepth,
        reveal: node.view.reveal,
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
    diagramChildCount: tree.root.visual.diagramChildCount,
    diagramChildTypeCounts: tree.root.visual.diagramChildTypeCounts,
    view: {
      expanded: true,
      hidden: false,
      highlighted: false,
      isOnlyChild: false,
      reveal: tree.root.view.reveal,
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
  schema: SchemaModule;
}) => {
  const { tree, scopeBoundaryId, relations, schema } = params;
  const relationTypeById = new Map(schema.relations.map((relation) => [relation.id, relation]));
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

  const edges: CompiledDiagramEdge[] = [];
  for (const relation of relations) {
    if (!isRenderableRelationType(relation.type)) {
      continue;
    }
    const sourceId = resolveVisibleNodeId(relation.from);
    const targetId = resolveVisibleNodeId(relation.to);
    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }
    edges.push({
      id: buildCompiledDiagramEdgeId(relation.id, sourceId, targetId),
      relationId: relation.id,
      sourceId,
      targetId,
      semanticSourceId: relation.from,
      semanticTargetId: relation.to,
      type: relation.type,
      label: resolveRelationDisplayLabel(relation, relationTypeById),
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

export function compileDiagramViewState(
  params: CompileDiagramViewTreeParams,
): CompiledDiagramViewState {
  const {
    doc,
    schema,
    entityTree = buildEntityTree(doc),
    targetEntityIds,
    targetRelationIds,
    forceRevealTargets = false,
    preserveExpandedBranches = false,
  } = params;
  const renderableRelations = doc.relations.filter((relation) =>
    isRenderableRelationType(relation.type),
  );

  const normalizedViewState = normalizeDiagramViewState(doc.view);
  const workingTree = buildSemanticViewWorkingTree(entityTree);
  const effectiveExpansion = applyEffectiveExpansion({
    tree: workingTree,
    normalizedViewState,
  });
  const revealAndVisibility = applyRevealAndVisibility({
    tree: workingTree,
    scopeRootId: effectiveExpansion.scopeRootId,
    effectiveExpanded: effectiveExpansion.effectiveExpanded,
    targetEntityIds,
    targetRelationIds,
    relations: renderableRelations,
    forceRevealTargets,
    preserveExpandedBranches,
  });
  applySemanticVisualAugmentation({
    tree: workingTree,
  });
  const projectedTree = projectCompiledDiagramView({
    tree: workingTree,
    scopeBoundaryId: revealAndVisibility.scopeBoundaryId,
  });

  return {
    tree: projectedTree,
    edges: projectCompiledDiagramEdges({
      tree: workingTree,
      scopeBoundaryId: revealAndVisibility.scopeBoundaryId,
      relations: renderableRelations,
      schema,
    }),
    nodePaintOrder: buildCompiledDiagramNodePaintOrder(projectedTree),
  };
}

export function compileDiagramViewTree(params: CompileDiagramViewTreeParams): DiagramViewTree {
  return compileDiagramViewState(params).tree;
}

export { getDiagramViewExpandedMap } from './normalize-diagram-view';
