import { parseNodeRefinementResponse } from './node-refinement';
import {
  dedupeEdgeContracts,
  dedupeEvidence,
  extractJsonResponse,
  normalizeEvidence,
  normalizeStringArray,
} from './refinement-helpers';

export { extractJsonResponse } from './refinement-helpers';

import {
  type Diagnostic,
  diagramDiagnostic,
  type Entity,
  type Relation,
  type SchemaSemantics,
  type SemanticDocument,
} from '../semantic';
import { assertYamlInputSize, parseYamlText as parseYaml } from '../untrusted-yaml';
import {
  applyNodeRefinementResult,
  assembleRefinedDocument,
  buildChildTask,
  buildInitialNodeRefinementState,
  type NodeRefinementSchemaContext,
  normalizeEdgeRefinementOrientation,
  validateNodeRefinementSemantics,
} from './node-refinement-engine';
import type {
  ActiveEdgeProposal,
  AppliedNodeRefinement,
  AreaPlan,
  AreaPlanEvidence,
  ChildNodeSpec,
  ChildRelationSpec,
  InheritedEdgeProposal,
  InheritedEdgeRefinement,
  NodeQueueDecision,
  NodeRefinementResult,
  NodeRefinementState,
  RefinableEdgeContract,
  Wave1ReviewEntityUpdate,
  Wave1ReviewPatch,
  Wave1ReviewRefinementPatch,
  Wave1ReviewRootEdit,
  Wave1ReviewSummary,
  Wave1ReviewVisibleRelationSpec,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildEvidenceFromPaths(paths: string[]): AreaPlanEvidence[] {
  return [...new Set(paths.filter((path) => path.trim().length > 0))].map((path) => ({
    path,
    reason: `Derived from reviewed artifact path ${path}`,
  }));
}

function evidenceFromProvenance(
  provenance: Entity['provenance'] | Relation['provenance'] | undefined,
): AreaPlanEvidence[] {
  const paths =
    provenance?.locations
      ?.map((location) => location.path?.trim())
      .filter((path): path is string => Boolean(path)) ?? [];
  return buildEvidenceFromPaths(paths);
}

function normalizeEntityUpdate(value: unknown): Wave1ReviewEntityUpdate | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Wave1ReviewEntityUpdate = {};
  if (isNonEmptyString(value.typeId)) {
    result.typeId = value.typeId.trim();
  }
  if (typeof value.name === 'string') {
    result.name = value.name.trim();
  }
  if (typeof value.description === 'string') {
    result.description = value.description.trim();
  }
  if (isRecord(value.props)) {
    result.props = value.props;
  }
  const evidence = normalizeEvidence(value.evidence);
  if (evidence.length > 0) {
    result.evidence = evidence;
  }
  return result;
}

function normalizeNodeRefinementPatch(value: unknown): Wave1ReviewRefinementPatch | undefined {
  if (!isRecord(value)) return undefined;
  const normalized = parseNodeRefinementResponse(JSON.stringify(value));
  if (normalized.parseDiagnostics?.length) {
    throw new Error(normalized.parseDiagnostics.map((diagnostic) => diagnostic.message).join('; '));
  }
  const patch: Wave1ReviewRefinementPatch = {};
  for (const key of [
    'children',
    'relations',
    'edgeRefinements',
    'edgeProposals',
    'suggestedSchemaRefs',
    'description',
    'openQuestions',
  ] as const) {
    if (hasOwn(value, key)) Object.assign(patch, { [key]: normalized[key] });
  }
  return patch;
}

function normalizeVisibleRelationSpec(value: unknown): Wave1ReviewVisibleRelationSpec | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.fromId) ||
    !isNonEmptyString(value.toId)
  ) {
    return null;
  }
  return {
    id: value.id.trim(),
    typeId: typeof value.typeId === 'string' ? value.typeId.trim() : undefined,
    description: typeof value.description === 'string' ? value.description.trim() : undefined,
    fromId: value.fromId.trim(),
    toId: value.toId.trim(),
    evidence: normalizeEvidence(value.evidence),
  } satisfies Wave1ReviewVisibleRelationSpec;
}

function normalizeRootEdit(value: unknown): Wave1ReviewRootEdit | null {
  if (!isRecord(value) || !isNonEmptyString(value.rootId)) {
    return null;
  }
  return {
    rootId: value.rootId.trim(),
    removeRoot: value.removeRoot === true,
    root: normalizeEntityUpdate(value.root),
    refinement: normalizeNodeRefinementPatch(value.refinement),
  } satisfies Wave1ReviewRootEdit;
}

export function parseWave1ReviewPatchResponse(response: string): Wave1ReviewPatch {
  assertYamlInputSize(response);
  const extracted = extractJsonResponse(response);
  const parsed = (
    extracted.trim().startsWith('{') || extracted.trim().startsWith('[')
      ? JSON.parse(extracted)
      : parseYaml(extracted)
  ) as Record<string, unknown>;
  const replacementRootRelations = Array.isArray(parsed.replaceRootRelations)
    ? parsed.replaceRootRelations
        .map((entry) => normalizeVisibleRelationSpec(entry))
        .filter((entry): entry is Wave1ReviewVisibleRelationSpec => entry !== null)
    : undefined;
  return {
    ...(Array.isArray(parsed.rootEdits)
      ? {
          rootEdits: parsed.rootEdits
            .map((entry) => normalizeRootEdit(entry))
            .filter((entry): entry is Wave1ReviewRootEdit => entry !== null),
        }
      : {}),
    ...(replacementRootRelations && replacementRootRelations.length > 0
      ? {
          replaceRootRelations: replacementRootRelations,
        }
      : {}),
    ...(Array.isArray(parsed.addVisibleRelations)
      ? {
          addVisibleRelations: parsed.addVisibleRelations
            .map((entry) => normalizeVisibleRelationSpec(entry))
            .filter((entry): entry is Wave1ReviewVisibleRelationSpec => entry !== null),
        }
      : {}),
    ...(Array.isArray(parsed.updateVisibleRelations)
      ? {
          updateVisibleRelations: parsed.updateVisibleRelations
            .map((entry) => normalizeVisibleRelationSpec(entry))
            .filter((entry): entry is Wave1ReviewVisibleRelationSpec => entry !== null),
        }
      : {}),
    ...(Array.isArray(parsed.removeVisibleRelationIds)
      ? {
          removeVisibleRelationIds: normalizeStringArray(parsed.removeVisibleRelationIds),
        }
      : {}),
    ...(Array.isArray(parsed.suggestedSchemaRefs)
      ? {
          suggestedSchemaRefs: normalizeStringArray(parsed.suggestedSchemaRefs),
        }
      : {}),
  } satisfies Wave1ReviewPatch;
}

function refinementResultFromApplied(refinement: AppliedNodeRefinement): NodeRefinementResult {
  const childLocalIds = new Map(
    refinement.children.map((child) => [child.id, child.localId] as const),
  );
  return {
    children: refinement.children.map((child) => ({
      localId: child.localId,
      name: child.name ?? child.localId,
      description: child.description,
      typeId: child.typeId,
      props: child.props,
      scope: [...child.scope],
      evidence: [...child.evidence],
      queueDecision: child.queueDecision,
      groupMode: child.groupMode,
      groupTypeId: child.groupTypeId,
    })),
    relations: refinement.relations
      .map((relation) => {
        const fromLocalId = childLocalIds.get(relation.sourceId);
        const toLocalId = childLocalIds.get(relation.targetId);
        if (!fromLocalId || !toLocalId) {
          return null;
        }
        return {
          localId: relation.id,
          typeId: relation.relationTypeId ?? '',
          description: relation.description,
          fromLocalId,
          toLocalId,
          evidence: [...relation.evidence],
        } satisfies ChildRelationSpec;
      })
      .filter(Boolean) as ChildRelationSpec[],
    edgeRefinements: refinement.edgeRefinements.map((edge) => ({
      edgeId: edge.edgeId,
      relationTypeId: edge.relationTypeId,
      fromChildLocalId: childLocalIds.get(edge.sourceId),
      toChildLocalId: childLocalIds.get(edge.targetId),
    })),
    edgeProposals: refinement.edgeProposals.map((proposal) => ({
      edgeId: proposal.edgeId,
      endpoint: proposal.endpoint,
      relationTypeId: proposal.relationTypeId,
      childLocalId: proposal.childLocalId,
    })),
    description: refinement.description,
    openQuestions: [...refinement.openQuestions],
  };
}

function emptyRefinementResult(): NodeRefinementResult {
  return {
    children: [],
    relations: [],
    edgeRefinements: [],
    edgeProposals: [],
    openQuestions: [],
  };
}

function filterRelationsForChildren(
  relations: ChildRelationSpec[],
  childLocalIds: Set<string>,
): ChildRelationSpec[] {
  return relations.filter(
    (relation) => childLocalIds.has(relation.fromLocalId) && childLocalIds.has(relation.toLocalId),
  );
}

function filterEdgeRefinementsForChildren(
  edgeRefinements: InheritedEdgeRefinement[],
  childLocalIds: Set<string>,
): InheritedEdgeRefinement[] {
  return edgeRefinements.filter(
    (edgeRefinement) =>
      (!edgeRefinement.fromChildLocalId || childLocalIds.has(edgeRefinement.fromChildLocalId)) &&
      (!edgeRefinement.toChildLocalId || childLocalIds.has(edgeRefinement.toChildLocalId)),
  );
}

function filterEdgeProposalsForChildren(
  edgeProposals: InheritedEdgeProposal[],
  childLocalIds: Set<string>,
): InheritedEdgeProposal[] {
  return edgeProposals.filter((edgeProposal) => childLocalIds.has(edgeProposal.childLocalId));
}

function mergeRefinementPatch(params: {
  existing?: AppliedNodeRefinement;
  patch: Wave1ReviewRefinementPatch;
}): NodeRefinementResult {
  const base = params.existing
    ? refinementResultFromApplied(params.existing)
    : emptyRefinementResult();
  const children = hasOwn(params.patch, 'children') ? (params.patch.children ?? []) : base.children;
  const childLocalIds = new Set(children.map((child) => child.localId));
  const relations = hasOwn(params.patch, 'relations')
    ? (params.patch.relations ?? [])
    : filterRelationsForChildren(base.relations, childLocalIds);
  const edgeRefinements = hasOwn(params.patch, 'edgeRefinements')
    ? (params.patch.edgeRefinements ?? [])
    : filterEdgeRefinementsForChildren(base.edgeRefinements, childLocalIds);
  const edgeProposals = hasOwn(params.patch, 'edgeProposals')
    ? (params.patch.edgeProposals ?? [])
    : filterEdgeProposalsForChildren(base.edgeProposals ?? [], childLocalIds);

  return {
    children,
    relations,
    edgeRefinements,
    edgeProposals,
    ...(hasOwn(params.patch, 'suggestedSchemaRefs')
      ? { suggestedSchemaRefs: params.patch.suggestedSchemaRefs ?? [] }
      : base.suggestedSchemaRefs
        ? { suggestedSchemaRefs: [...base.suggestedSchemaRefs] }
        : {}),
    description: hasOwn(params.patch, 'description') ? params.patch.description : base.description,
    openQuestions: hasOwn(params.patch, 'openQuestions')
      ? (params.patch.openQuestions ?? [])
      : (base.openQuestions ?? []),
  };
}

function relationSpecFromContract(edge: RefinableEdgeContract): Wave1ReviewVisibleRelationSpec {
  return {
    id: edge.id,
    typeId: edge.relationTypeId,
    description: edge.description,
    fromId: edge.sourceId,
    toId: edge.targetId,
    evidence: [...edge.evidence],
  };
}

function relationSpecFromDocumentRelation(relation: Relation): Wave1ReviewVisibleRelationSpec {
  return {
    id: relation.id,
    typeId: relation.type,
    description: relation.description,
    fromId: relation.from,
    toId: relation.to,
    evidence: evidenceFromProvenance(relation.provenance),
  };
}

function toEntityProvenance(
  evidence: AreaPlanEvidence[] | undefined,
): Entity['provenance'] | undefined {
  const normalized = dedupeEvidence(evidence ?? []);
  if (normalized.length === 0) {
    return undefined;
  }
  return {
    locations: normalized.map((entry) => ({
      input: 'primary',
      path: entry.path,
    })),
  };
}

function toRelationProvenance(
  evidence: AreaPlanEvidence[] | undefined,
): Relation['provenance'] | undefined {
  const normalized = dedupeEvidence(evidence ?? []);
  if (normalized.length === 0) {
    return undefined;
  }
  return {
    locations: normalized.map((entry) => ({
      input: 'primary',
      path: entry.path,
    })),
  };
}

function createRelationFromSpec(spec: Wave1ReviewVisibleRelationSpec): Relation {
  return {
    id: spec.id,
    type: spec.typeId,
    description: spec.description,
    from: spec.fromId,
    to: spec.toId,
    provenance: toRelationProvenance(spec.evidence),
  };
}

function createEdgeContractFromSpec(
  spec: Wave1ReviewVisibleRelationSpec,
  nodeTypeById: Map<string, string>,
): RefinableEdgeContract {
  return {
    id: spec.id,
    relationTypeId: spec.typeId,
    description: spec.description,
    sourceId: spec.fromId,
    sourceTypeId: nodeTypeById.get(spec.fromId),
    targetId: spec.toId,
    targetTypeId: nodeTypeById.get(spec.toId),
    evidence: dedupeEvidence(spec.evidence),
  };
}

function buildNodeTypeById(state: NodeRefinementState): Map<string, string> {
  return new Map(Object.values(state.nodesById).map((node) => [node.id, node.typeId] as const));
}

function listDepth1NodeIds(state: NodeRefinementState): string[] {
  return state.rootNodeIds.flatMap(
    (rootId) => state.refinementsByNodeId[rootId]?.children.map((child) => child.id) ?? [],
  );
}

function buildVisibleNodeIdSet(state: NodeRefinementState): Set<string> {
  return new Set([...state.rootNodeIds, ...listDepth1NodeIds(state)]);
}

function endpointDepth(endpointId: string): number {
  return endpointId.split('/').filter((segment) => segment.length > 0).length;
}

function validateRelationEndpointVisibility(params: {
  relation: Wave1ReviewVisibleRelationSpec;
  field: 'fromId' | 'toId';
  endpointId: string;
  visibleNodeIds: Set<string>;
  rootNodeIds: Set<string>;
  rootOnly: boolean;
  collection: string;
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (endpointDepth(params.endpointId) > 2) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'error',
        code: 'diagram.wave1_review.relation_endpoint_too_deep',
        relationId: params.relation.id,
        targetId: params.endpointId,
        message: `Wave-1 ${params.collection} relation ${params.relation.id} uses ${params.field} endpoint ${params.endpointId}, but wave-1 relation endpoints may only target roots or direct children`,
      }),
    );
  }
  if (params.rootOnly && !params.rootNodeIds.has(params.endpointId)) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'error',
        code: 'diagram.wave1_review.root_relation_endpoint_not_root',
        relationId: params.relation.id,
        targetId: params.endpointId,
        message: `Wave-1 ${params.collection} relation ${params.relation.id} uses ${params.field} endpoint ${params.endpointId}, but root relation replacements may only target root ids`,
      }),
    );
    return diagnostics;
  }
  if (!params.visibleNodeIds.has(params.endpointId)) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'error',
        code: 'diagram.wave1_review.relation_endpoint_not_visible',
        relationId: params.relation.id,
        targetId: params.endpointId,
        message: `Wave-1 ${params.collection} relation ${params.relation.id} references ${params.field} endpoint ${params.endpointId}, which is not a visible root or direct child after the patch`,
      }),
    );
  }
  return diagnostics;
}

function validateVisibleRelationPatchContract(params: {
  patch: Wave1ReviewPatch;
  rebuiltState: NodeRefinementState;
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const visibleNodeIds = buildVisibleNodeIdSet(params.rebuiltState);
  const rootNodeIds = new Set(params.rebuiltState.rootNodeIds);
  const relationGroups: Array<{
    collection: string;
    rootOnly: boolean;
    relations: Wave1ReviewVisibleRelationSpec[];
  }> = [
    {
      collection: 'replaceRootRelations',
      rootOnly: true,
      relations: params.patch.replaceRootRelations ?? [],
    },
    {
      collection: 'addVisibleRelations',
      rootOnly: false,
      relations: params.patch.addVisibleRelations ?? [],
    },
    {
      collection: 'updateVisibleRelations',
      rootOnly: false,
      relations: params.patch.updateVisibleRelations ?? [],
    },
  ];

  for (const group of relationGroups) {
    for (const relation of group.relations) {
      diagnostics.push(
        ...validateRelationEndpointVisibility({
          relation,
          field: 'fromId',
          endpointId: relation.fromId,
          visibleNodeIds,
          rootNodeIds,
          rootOnly: group.rootOnly,
          collection: group.collection,
        }),
        ...validateRelationEndpointVisibility({
          relation,
          field: 'toId',
          endpointId: relation.toId,
          visibleNodeIds,
          rootNodeIds,
          rootOnly: group.rootOnly,
          collection: group.collection,
        }),
      );
    }
  }

  return diagnostics;
}

export function validateWave1ReviewPatchContract(params: {
  patch: Wave1ReviewPatch;
  previousState: NodeRefinementState;
  rebuiltState: NodeRefinementState;
  schemaContext: Pick<NodeRefinementSchemaContext, 'activeSchemaRefs' | 'schema' | 'semantics'>;
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [
    ...validateVisibleRelationPatchContract({
      patch: params.patch,
      rebuiltState: params.rebuiltState,
    }),
  ];

  for (const edit of params.patch.rootEdits ?? []) {
    if (edit.removeRoot || !edit.refinement) {
      continue;
    }
    const task =
      params.rebuiltState.tasksByNodeId[edit.rootId] ??
      params.previousState.tasksByNodeId[edit.rootId];
    const refinement = params.rebuiltState.refinementsByNodeId[edit.rootId];
    if (!task || !refinement) {
      continue;
    }
    diagnostics.push(
      ...validateNodeRefinementSemantics({
        task,
        result: refinementResultFromApplied(refinement),
        schema: params.schemaContext.schema,
        semantics: params.schemaContext.semantics,
        schemaActivations: params.schemaContext.activeSchemaRefs,
        activeEdgeProposals: params.previousState.activeEdgeProposals,
      }),
    );
  }

  return diagnostics;
}

export function buildWave1ReviewSummary(params: {
  state: NodeRefinementState;
  level0Doc: SemanticDocument;
}): Wave1ReviewSummary {
  const pendingDepth1NodeIds = params.state.queue
    .filter((task) => task.depth === 1)
    .map((task) => task.nodeId);
  const visibleNodeIdSet = buildVisibleNodeIdSet(params.state);
  const rootIdSet = new Set(params.state.rootNodeIds);
  const refinementByRootId = new Map(
    params.state.rootNodeIds
      .map((rootId) => {
        const refinement = params.state.refinementsByNodeId[rootId];
        return refinement ? ([rootId, refinementResultFromApplied(refinement)] as const) : null;
      })
      .filter((entry): entry is readonly [string, NodeRefinementResult] => entry !== null),
  );

  return {
    rootIds: [...params.state.rootNodeIds],
    roots: params.state.rootNodeIds
      .map((rootId) => {
        const node = params.state.nodesById[rootId];
        if (!node) {
          return null;
        }
        const refinement = params.state.refinementsByNodeId[rootId];
        return {
          rootId,
          typeId: node.typeId,
          name: node.name,
          description: node.description,
          scope: [...node.scope],
          evidence: [...node.evidence],
          queuedForRefinement: Boolean(params.state.tasksByNodeId[rootId]),
          directChildren: (refinement?.children ?? []).map((child) => ({
            id: child.id,
            localId: child.localId,
            name: child.name,
            typeId: child.typeId,
            queueDecision: child.queueDecision,
            scope: [...child.scope],
            evidence: [...child.evidence],
          })),
          refinement: refinement
            ? {
                description: refinement.description,
                openQuestions: [...refinement.openQuestions],
                relations: refinementByRootId.get(rootId)?.relations ?? [],
                edgeRefinements: refinementByRootId.get(rootId)?.edgeRefinements ?? [],
                edgeProposals: refinementByRootId.get(rootId)?.edgeProposals ?? [],
              }
            : undefined,
        };
      })
      .filter(Boolean) as Wave1ReviewSummary['roots'],
    rootRelations: params.level0Doc.relations.map((relation) =>
      relationSpecFromDocumentRelation(relation),
    ),
    visibleRelations: params.state.edgeContracts
      .filter((edge) => visibleNodeIdSet.has(edge.sourceId) && visibleNodeIdSet.has(edge.targetId))
      .filter((edge) => !(rootIdSet.has(edge.sourceId) && rootIdSet.has(edge.targetId)))
      .map((edge) => relationSpecFromContract(edge)),
    activeEdgeProposals: params.state.activeEdgeProposals.map((proposal) => ({ ...proposal })),
    pendingDepth1NodeIds,
    pendingDepth1QueueDecisionByNodeId: Object.fromEntries(
      pendingDepth1NodeIds.map((nodeId) => [
        nodeId,
        params.state.nodesById[nodeId]?.queueDecision ?? ('leaf' satisfies NodeQueueDecision),
      ]),
    ),
    reviewedDepths: [...params.state.reviewedDepths],
  };
}

function patchEntity(entity: Entity, update: Wave1ReviewEntityUpdate | undefined): Entity {
  if (!update) {
    return entity;
  }
  const evidence = update.evidence ?? evidenceFromProvenance(entity.provenance);
  return {
    ...entity,
    ...(update.typeId ? { type: update.typeId } : {}),
    ...(update.name !== undefined ? { name: update.name } : {}),
    ...(update.description !== undefined ? { description: update.description } : {}),
    ...(update.props !== undefined ? { props: update.props } : {}),
    provenance: toEntityProvenance(evidence),
  };
}

function applyWave1PatchToLevel0Doc(params: {
  level0Doc: SemanticDocument;
  patch: Wave1ReviewPatch;
}): SemanticDocument {
  const editByRootId = new Map(
    (params.patch.rootEdits ?? []).map((edit) => [edit.rootId, edit] as const),
  );
  const entities = params.level0Doc.entities
    .map((entity) => {
      const edit = editByRootId.get(entity.id);
      if (edit?.removeRoot) {
        return null;
      }
      return patchEntity({ ...entity, children: undefined }, edit?.root);
    })
    .filter((entity): entity is Entity => entity !== null);

  return {
    ...params.level0Doc,
    entities,
    relations:
      params.patch.replaceRootRelations !== undefined &&
      params.patch.replaceRootRelations.length > 0
        ? params.patch.replaceRootRelations.map((relation) => createRelationFromSpec(relation))
        : params.level0Doc.relations,
  };
}

function resolveRootRefinementResults(params: {
  state: NodeRefinementState;
  patch: Wave1ReviewPatch;
  survivingRootIds: string[];
}): Map<string, NodeRefinementResult> {
  const refinements = new Map<string, NodeRefinementResult>();
  const rootEditById = new Map(
    (params.patch.rootEdits ?? []).map((edit) => [edit.rootId, edit] as const),
  );
  for (const rootId of params.survivingRootIds) {
    const edit = rootEditById.get(rootId);
    if (edit?.refinement) {
      refinements.set(
        rootId,
        mergeRefinementPatch({
          existing: params.state.refinementsByNodeId[rootId],
          patch: edit.refinement,
        }),
      );
      continue;
    }
    const existing = params.state.refinementsByNodeId[rootId];
    if (existing) {
      refinements.set(rootId, refinementResultFromApplied(existing));
    }
  }
  return refinements;
}

function rebuildDepth1Tasks(
  state: NodeRefinementState,
): Pick<NodeRefinementState, 'queue' | 'tasksByNodeId'> {
  const rootTasks = Object.values(state.tasksByNodeId).filter((task) => task.depth === 0);
  const depth1Tasks = state.rootNodeIds.flatMap((rootId) =>
    (state.refinementsByNodeId[rootId]?.children ?? [])
      .filter((child) => child.queueDecision === 'expand')
      .map((child) =>
        buildChildTask({
          child,
          edgeContracts: state.edgeContracts,
          activeEdgeProposals: state.activeEdgeProposals,
          depth: 1,
        }),
      ),
  );
  return {
    queue: depth1Tasks,
    tasksByNodeId: {
      ...Object.fromEntries(rootTasks.map((task) => [task.nodeId, task])),
      ...Object.fromEntries(depth1Tasks.map((task) => [task.nodeId, task])),
    },
  };
}

function applyVisibleRelationEdits(params: {
  state: NodeRefinementState;
  patch: Wave1ReviewPatch;
}): NodeRefinementState {
  const removeIds = new Set(params.patch.removeVisibleRelationIds ?? []);
  const nodeTypeById = buildNodeTypeById(params.state);
  const filtered = params.state.edgeContracts.filter((edge) => !removeIds.has(edge.id));
  const byId = new Map(filtered.map((edge) => [edge.id, edge] as const));
  for (const relation of params.patch.updateVisibleRelations ?? []) {
    byId.set(relation.id, createEdgeContractFromSpec(relation, nodeTypeById));
  }
  for (const relation of params.patch.addVisibleRelations ?? []) {
    byId.set(relation.id, createEdgeContractFromSpec(relation, nodeTypeById));
  }
  return {
    ...params.state,
    edgeContracts: dedupeEdgeContracts([...byId.values()]),
  };
}

function normalizeReviewedDepths(reviewedDepths: number[]): number[] {
  return [...new Set(reviewedDepths)].sort((left, right) => left - right);
}

export function applyWave1ReviewPatch(params: {
  semantics: SchemaSemantics;
  level0Doc: SemanticDocument;
  areaPlan: AreaPlan;
  visibleResponsibilityIds: string[];
  previousState: NodeRefinementState;
  patch: Wave1ReviewPatch;
}): {
  reviewedLevel0Doc: SemanticDocument;
  rebuiltState: NodeRefinementState;
  wave1Document: SemanticDocument;
} {
  const reviewedLevel0Doc = applyWave1PatchToLevel0Doc({
    level0Doc: params.level0Doc,
    patch: params.patch,
  });
  const survivingRootIds = reviewedLevel0Doc.entities.map((entity) => entity.id);
  const initialState = buildInitialNodeRefinementState({
    semantics: params.semantics,
    level0Doc: reviewedLevel0Doc,
    areaPlan: params.areaPlan,
    visibleResponsibilityIds: params.visibleResponsibilityIds.filter((rootId) =>
      survivingRootIds.includes(rootId),
    ),
    maxDepth: params.previousState.budgets.maxDepth,
  });

  let replayedState = initialState;
  const refinementResults = resolveRootRefinementResults({
    state: params.previousState,
    patch: params.patch,
    survivingRootIds,
  });

  for (const rootId of survivingRootIds) {
    const result = refinementResults.get(rootId);
    const task = replayedState.tasksByNodeId[rootId];
    if (!result || !task) {
      continue;
    }
    replayedState = applyNodeRefinementResult({
      state: replayedState,
      task,
      result: normalizeEdgeRefinementOrientation({
        semantics: params.semantics,
        task,
        result,
        inferEvidenceMatchedEdgeRefinements: false,
      }),
    });
  }

  replayedState = applyVisibleRelationEdits({
    state: replayedState,
    patch: params.patch,
  });
  const rebuiltQueue = rebuildDepth1Tasks(replayedState);
  const rebuiltState: NodeRefinementState = {
    ...replayedState,
    queue: rebuiltQueue.queue,
    tasksByNodeId: rebuiltQueue.tasksByNodeId,
    reviewedDepths: normalizeReviewedDepths([...params.previousState.reviewedDepths, 1]),
    budgets: {
      ...params.previousState.budgets,
      workItemsCreated: Math.max(
        params.previousState.budgets.workItemsCreated,
        initialState.rootNodeIds.length + rebuiltQueue.queue.length,
      ),
    },
  };

  return {
    reviewedLevel0Doc,
    rebuiltState,
    wave1Document: assembleRefinedDocument({
      semantics: params.semantics,
      baseDoc: reviewedLevel0Doc,
      state: rebuiltState,
    }),
  };
}

export function buildWave1ReviewPromptArtifacts(params: {
  semantics: SchemaSemantics;
  level0Doc: SemanticDocument;
  state: NodeRefinementState;
}): {
  wave1Document: SemanticDocument;
  wave1Summary: Wave1ReviewSummary;
} {
  return {
    wave1Document: assembleRefinedDocument({
      semantics: params.semantics,
      baseDoc: params.level0Doc,
      state: params.state,
    }),
    wave1Summary: buildWave1ReviewSummary({
      state: params.state,
      level0Doc: params.level0Doc,
    }),
  };
}
