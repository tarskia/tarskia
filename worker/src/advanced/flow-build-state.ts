import {
  analyzeDocumentFlow,
  buildEntityIndex,
  compileSchemaSemantics,
  type Diagnostic,
  type DocumentFlowAnalysis,
  type Entity,
  getResolvedTypeSemantics,
  resolveTypeDef,
  type SchemaModule,
  type SchemaSemantics,
  type SemanticDocument,
} from '../semantic';
import { isGroupLikeType } from './refinement-helpers';
import type {
  ActiveEdgeProposal,
  EdgeExpectation,
  FlowBoundarySide,
  FlowBuildState,
  FlowTerminationReason,
  InheritedBoundaryEdge,
  InheritedBoundaryFlow,
  Level0PathFrontierEntry,
  RefinedEndpointBinding,
  TerminatedFlowNode,
} from './types';

export interface SerializedFlowAnalysis {
  entities: ReturnType<typeof serializeEntityFlowAnalysis>;
  relations: ReturnType<typeof serializeRelationFlowAnalysis>;
}

export interface SerializedFlowBuildState {
  level0EdgeIds: string[];
  visibleResponsibilityIds: string[];
  activeFrontier: Level0PathFrontierEntry[];
  terminatedNodes: TerminatedFlowNode[];
  refinementQueue: Array<{
    containerId: string;
    inboundEdges: InheritedBoundaryEdge[];
    outboundEdges: InheritedBoundaryEdge[];
  }>;
  edgeBindings: RefinedEndpointBinding[];
}

const flattenEntityIds = (entities: Entity[]): string[] => {
  const ids: string[] = [];
  const visit = (items: Entity[]) => {
    for (const entity of items) {
      ids.push(entity.id);
      if (entity.children) {
        visit(entity.children);
      }
    }
  };
  visit(entities);
  return ids;
};

const serializeEntityFlowAnalysis = (analysis: DocumentFlowAnalysis) =>
  [...analysis.entitiesById.values()]
    .map((entry) => ({
      entityId: entry.entityId,
      entityTypeId: entry.entityTypeId,
      flowRole: entry.flowRole,
      expectations: entry.expectations,
      fulfillment: entry.fulfillment,
      contributingRelationIds: entry.contributingRelationIds,
    }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));

const serializeRelationFlowAnalysis = (analysis: DocumentFlowAnalysis) =>
  [...analysis.relationsById.values()]
    .map((entry) => ({
      relationId: entry.relationId,
      relationTypeId: entry.relationTypeId,
      sourceId: entry.sourceId,
      targetId: entry.targetId,
      sourceTypeId: entry.sourceTypeId,
      targetTypeId: entry.targetTypeId,
      fulfillment: entry.fulfillment,
      countsForExpectationFulfillment: entry.countsForExpectationFulfillment,
      issues: entry.issues,
    }))
    .sort((left, right) => left.relationId.localeCompare(right.relationId));

const buildFrontierKey = (entityId: string, side: FlowBoundarySide) => `${entityId}:${side}`;
type PreservedBoundaryFlowRole = 'sink' | 'source';

const isPreferredTopLevelBoundaryWithoutFlow = (
  schema: SchemaModule,
  semantics: SchemaSemantics,
  typeId: string,
): boolean => {
  const typeDef = resolveTypeDef(schema, typeId);
  const typeSemantics = getResolvedTypeSemantics(semantics, typeId);
  return (
    typeDef?.analysis?.topLevelBias === 'prefer' &&
    typeSemantics?.expectations.flowRole === 'none' &&
    typeSemantics.expectations.mayTerminate !== true
  );
};

const getPreservedBoundaryFlowRole = (flowRole: string): PreservedBoundaryFlowRole | undefined => {
  if (flowRole === 'sink' || flowRole === 'source') {
    return flowRole;
  }
  return undefined;
};

const getBoundarySideForFlowRole = (flowRole: PreservedBoundaryFlowRole): FlowBoundarySide =>
  flowRole === 'sink' ? 'ingress' : 'egress';

const isDescendantOf = (
  entityId: string,
  ancestorId: string,
  parentById: ReadonlyMap<string, string | undefined>,
): boolean => {
  let cursorId = parentById.get(entityId);
  while (cursorId) {
    if (cursorId === ancestorId) {
      return true;
    }
    cursorId = parentById.get(cursorId);
  }
  return false;
};

const isWithinSubtree = (
  entityId: string,
  rootId: string,
  parentById: ReadonlyMap<string, string | undefined>,
): boolean => entityId === rootId || isDescendantOf(entityId, rootId, parentById);

function buildRefinedBoundaryDiagnostics(params: {
  flowBuildState: FlowBuildState;
  analysis: DocumentFlowAnalysis;
}): Diagnostic[] {
  const entityIndex = buildEntityIndex(params.flowBuildState.level0Doc.entities);
  const diagnostics: Diagnostic[] = [];

  for (const entityEntry of entityIndex.entries) {
    const directChildren = entityIndex.childrenByParent.get(entityEntry.entity.id) ?? [];
    if (directChildren.length === 0) {
      continue;
    }

    const entityAnalysis = params.analysis.entitiesById.get(entityEntry.entity.id);
    if (!entityAnalysis) {
      continue;
    }

    const preservedFlowRole = getPreservedBoundaryFlowRole(entityAnalysis.flowRole);
    if (!preservedFlowRole) {
      continue;
    }

    const relevantSide = getBoundarySideForFlowRole(preservedFlowRole);
    const matchingDirectChildren = directChildren.filter((child) => {
      const childAnalysis = params.analysis.entitiesById.get(child.id);
      return childAnalysis?.flowRole === preservedFlowRole;
    });

    if (matchingDirectChildren.length === 0) {
      diagnostics.push({
        domain: 'diagram',
        severity: 'warning',
        phase: 'document',
        code:
          preservedFlowRole === 'sink'
            ? 'diagram.flow.refined_sink_without_child_sink'
            : 'diagram.flow.refined_source_without_child_source',
        message:
          preservedFlowRole === 'sink'
            ? `${entityEntry.entity.id} is refined but none of its direct children preserve sink flow`
            : `${entityEntry.entity.id} is refined but none of its direct children preserve source flow`,
        entityId: entityEntry.entity.id,
        hint:
          preservedFlowRole === 'sink'
            ? 'Add a direct child sink so refined ingress can terminate one level below this boundary.'
            : 'Add a direct child source so refined egress can originate one level below this boundary.',
        details: {
          flowRole: preservedFlowRole,
          directChildIds: directChildren.map((child) => child.id),
          directChildFlowRoles: directChildren.map((child) => ({
            entityId: child.id,
            flowRole: params.analysis.entitiesById.get(child.id)?.flowRole ?? 'none',
          })),
        },
      });
      continue;
    }

    const directBoundaryRelationIds = [...params.analysis.relationsById.values()]
      .filter((relationAnalysis) => {
        if (!relationAnalysis.countsForExpectationFulfillment) {
          return false;
        }
        if (relevantSide === 'ingress') {
          return (
            relationAnalysis.targetId === entityEntry.entity.id &&
            relationAnalysis.fulfillment.to.includes('ingress') &&
            !isWithinSubtree(
              relationAnalysis.sourceId,
              entityEntry.entity.id,
              entityIndex.parentById,
            )
          );
        }
        return (
          relationAnalysis.sourceId === entityEntry.entity.id &&
          relationAnalysis.fulfillment.from.includes('egress') &&
          !isWithinSubtree(relationAnalysis.targetId, entityEntry.entity.id, entityIndex.parentById)
        );
      })
      .map((relationAnalysis) => relationAnalysis.relationId)
      .sort((left, right) => left.localeCompare(right));

    if (directBoundaryRelationIds.length === 0) {
      continue;
    }

    diagnostics.push({
      domain: 'diagram',
      severity: 'warning',
      phase: 'document',
      code:
        preservedFlowRole === 'sink'
          ? 'diagram.flow.refined_sink_parent_ingress_not_internalized'
          : 'diagram.flow.refined_source_parent_egress_not_internalized',
      message:
        preservedFlowRole === 'sink'
          ? `${entityEntry.entity.id} still terminates external ingress on the parent instead of a direct child sink`
          : `${entityEntry.entity.id} still originates external egress from the parent instead of a direct child source`,
      entityId: entityEntry.entity.id,
      hint:
        preservedFlowRole === 'sink'
          ? 'Retarget external ingress to a direct child sink when refining this boundary.'
          : 'Retarget external egress to a direct child source when refining this boundary.',
      details: {
        flowRole: preservedFlowRole,
        directBoundaryRelationIds,
        matchingChildIds: matchingDirectChildren.map((child) => child.id),
      },
    });
  }

  return diagnostics;
}

const buildBoundaryEdge = (
  relation: SemanticDocument['relations'][number],
  entityTypeById: ReadonlyMap<string, string>,
): InheritedBoundaryEdge => ({
  edgeId: relation.id,
  relationTypeId: relation.type,
  sourceId: relation.from,
  sourceTypeId: entityTypeById.get(relation.from),
  targetId: relation.to,
  targetTypeId: entityTypeById.get(relation.to),
});

const buildEntityTypeById = (entities: SemanticDocument['entities']): Map<string, string> => {
  const entityTypeById = new Map<string, string>();
  const visit = (items: SemanticDocument['entities']) => {
    for (const entity of items) {
      entityTypeById.set(entity.id, entity.type);
      visit(entity.children ?? []);
    }
  };
  visit(entities);
  return entityTypeById;
};

function buildActiveEdgeProposalMap(
  activeEdgeProposals: ActiveEdgeProposal[],
): Map<string, Partial<Record<'from' | 'to', ActiveEdgeProposal>>> {
  const byEdgeId = new Map<string, Partial<Record<'from' | 'to', ActiveEdgeProposal>>>();
  for (const proposal of activeEdgeProposals) {
    const current = byEdgeId.get(proposal.edgeId) ?? {};
    current[proposal.endpoint] = proposal;
    byEdgeId.set(proposal.edgeId, current);
  }
  return byEdgeId;
}

export function buildFlowExpectationsFromEdgeProposals(params: {
  doc: SemanticDocument;
  activeEdgeProposals: ActiveEdgeProposal[];
}): EdgeExpectation[] {
  const coarseRelationById = new Map(
    params.doc.relations.map((relation) => [relation.id, relation] as const),
  );
  const proposalMap = buildActiveEdgeProposalMap(params.activeEdgeProposals);
  return [...proposalMap.entries()]
    .map(([edgeId, endpoints]): EdgeExpectation | undefined => {
      const coarseRelation = coarseRelationById.get(edgeId);
      if (!coarseRelation) {
        return undefined;
      }
      const sourceProposal = endpoints.from;
      const targetProposal = endpoints.to;
      return {
        id: edgeId,
        kind:
          sourceProposal?.relationTypeId ??
          targetProposal?.relationTypeId ??
          coarseRelation.type ??
          '',
        summary: `Deferred refinement for ${edgeId}`,
        confidence: 'medium' as const,
        evidence: [],
        source: {
          responsibilityId: coarseRelation.from,
          proposal: sourceProposal
            ? {
                ownerLocalId: sourceProposal.childLocalId,
                specificity: 'actor',
                depth: sourceProposal.childId.split('/').length,
                confidence: 'medium',
                rationale: `Deferred source-side refinement within ${sourceProposal.ownerNodeId}`,
                evidence: [],
                absoluteChildId: sourceProposal.childId,
                relationTypeId: sourceProposal.relationTypeId,
              }
            : undefined,
          status: sourceProposal ? 'proposed' : 'unresolved',
        },
        target: {
          responsibilityId: coarseRelation.to,
          proposal: targetProposal
            ? {
                ownerLocalId: targetProposal.childLocalId,
                specificity: 'actor',
                depth: targetProposal.childId.split('/').length,
                confidence: 'medium',
                rationale: `Deferred target-side refinement within ${targetProposal.ownerNodeId}`,
                evidence: [],
                absoluteChildId: targetProposal.childId,
                relationTypeId: targetProposal.relationTypeId,
              }
            : undefined,
          status: targetProposal ? 'proposed' : 'unresolved',
        },
        status:
          sourceProposal && targetProposal
            ? 'matched'
            : sourceProposal || targetProposal
              ? 'partially-proposed'
              : 'open',
        history: [],
      } satisfies EdgeExpectation;
    })
    .filter((expectation): expectation is EdgeExpectation => expectation !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildExpectationOverlayRelations(
  doc: SemanticDocument,
  expectations: EdgeExpectation[],
): SemanticDocument['relations'] {
  const relationById = new Map(doc.relations.map((relation) => [relation.id, relation] as const));
  return expectations.flatMap((expectation) => {
    if (!expectation.source.proposal && !expectation.target.proposal) {
      return [];
    }
    const coarseRelation = relationById.get(expectation.id);
    if (!coarseRelation) {
      return [];
    }
    return [
      {
        id: `proposal--${expectation.id}`,
        type:
          expectation.source.proposal?.relationTypeId ??
          expectation.target.proposal?.relationTypeId ??
          coarseRelation.type,
        from: expectation.source.proposal?.absoluteChildId ?? expectation.source.responsibilityId,
        to: expectation.target.proposal?.absoluteChildId ?? expectation.target.responsibilityId,
      } satisfies SemanticDocument['relations'][number],
    ];
  });
}

const sortFrontierEntries = (entries: Level0PathFrontierEntry[]) =>
  [...entries].sort((left, right) => {
    const leftKey = `${left.entityId}:${left.side}`;
    const rightKey = `${right.entityId}:${right.side}`;
    return leftKey.localeCompare(rightKey);
  });

const sortTerminatedEntries = (entries: TerminatedFlowNode[]) =>
  [...entries].sort((left, right) => {
    const leftKey = `${left.entityId}:${left.side}`;
    const rightKey = `${right.entityId}:${right.side}`;
    return leftKey.localeCompare(rightKey);
  });

const buildRefinementQueue = (params: {
  doc: SemanticDocument;
  visibleResponsibilityIds: string[];
}): InheritedBoundaryFlow[] =>
  params.visibleResponsibilityIds
    .map((containerId) => {
      const entityTypeById = buildEntityTypeById(params.doc.entities);
      const inboundEdges = params.doc.relations
        .filter((relation) => relation.to === containerId)
        .map((relation) => buildBoundaryEdge(relation, entityTypeById))
        .sort((left, right) => left.edgeId.localeCompare(right.edgeId));
      const outboundEdges = params.doc.relations
        .filter((relation) => relation.from === containerId)
        .map((relation) => buildBoundaryEdge(relation, entityTypeById))
        .sort((left, right) => left.edgeId.localeCompare(right.edgeId));
      return {
        containerId,
        inboundEdges,
        outboundEdges,
        ancestorDoc: params.doc,
      };
    })
    .sort((left, right) => left.containerId.localeCompare(right.containerId));

const buildEdgeBindings = (params: {
  doc: SemanticDocument;
  expectations: EdgeExpectation[];
}): RefinedEndpointBinding[] => {
  const bindings: RefinedEndpointBinding[] = [];

  for (const expectation of params.expectations) {
    const matchedLevel0Edge =
      params.doc.relations.find((relation) => relation.id === expectation.id) ??
      params.doc.relations.find(
        (relation) =>
          relation.from === expectation.source.responsibilityId &&
          relation.to === expectation.target.responsibilityId,
      );

    if (!matchedLevel0Edge) {
      continue;
    }

    if (expectation.source.proposal) {
      bindings.push({
        level0EdgeId: matchedLevel0Edge.id,
        expectationId: expectation.id,
        endpoint: 'from',
        responsibilityId: expectation.source.responsibilityId,
        localId: expectation.source.proposal.ownerLocalId,
      });
    }
    if (expectation.target.proposal) {
      bindings.push({
        level0EdgeId: matchedLevel0Edge.id,
        expectationId: expectation.id,
        endpoint: 'to',
        responsibilityId: expectation.target.responsibilityId,
        localId: expectation.target.proposal.ownerLocalId,
      });
    }
  }

  return bindings.sort((left, right) => {
    const leftKey = `${left.level0EdgeId}:${left.endpoint}:${left.localId}`;
    const rightKey = `${right.level0EdgeId}:${right.endpoint}:${right.localId}`;
    return leftKey.localeCompare(rightKey);
  });
};

const buildFlowStatusSummary = (params: {
  analysis: DocumentFlowAnalysis;
  continuationAttempts: ReadonlyMap<string, number>;
}): Pick<FlowBuildState, 'activeFrontier' | 'terminatedNodes'> => {
  const activeFrontier: Level0PathFrontierEntry[] = [];
  const terminatedNodes: TerminatedFlowNode[] = [];

  for (const entityAnalysis of params.analysis.entitiesById.values()) {
    const { expectations, fulfillment } = entityAnalysis;
    const missingSides: FlowBoundarySide[] = [];
    if (fulfillment.ingress.status === 'missing') {
      missingSides.push('ingress');
    }
    if (fulfillment.egress.status === 'missing') {
      missingSides.push('egress');
    }

    for (const side of missingSides) {
      const attemptCount =
        params.continuationAttempts.get(buildFrontierKey(entityAnalysis.entityId, side)) ?? 0;
      if (expectations.mayTerminate && attemptCount > 0) {
        terminatedNodes.push({
          entityId: entityAnalysis.entityId,
          entityTypeId: entityAnalysis.entityTypeId,
          side,
          reason: 'boundary',
        });
        continue;
      }
      activeFrontier.push({
        entityId: entityAnalysis.entityId,
        entityTypeId: entityAnalysis.entityTypeId,
        side,
        flowRole: entityAnalysis.flowRole,
        mayTerminate: expectations.mayTerminate,
        attemptCount,
      });
    }
  }

  return {
    activeFrontier: sortFrontierEntries(activeFrontier),
    terminatedNodes: sortTerminatedEntries(terminatedNodes),
  };
};

export function buildFlowBuildState(params: {
  level0Doc: SemanticDocument;
  effectiveSchema: SchemaModule;
  repoOwnedResponsibilityIds: string[];
  expectations?: EdgeExpectation[];
  continuationAttempts?: ReadonlyMap<string, number>;
}): { state: FlowBuildState; analysis: DocumentFlowAnalysis } {
  const continuationAttempts = params.continuationAttempts ?? new Map<string, number>();
  const expectationOverlayRelations = buildExpectationOverlayRelations(
    params.level0Doc,
    params.expectations ?? [],
  );
  const analysis = analyzeDocumentFlow({
    doc: {
      ...params.level0Doc,
      relations: [...params.level0Doc.relations, ...expectationOverlayRelations],
    },
    schema: params.effectiveSchema,
  });
  const visibleEntityIds = new Set(flattenEntityIds(params.level0Doc.entities));
  const visibleResponsibilityIds = params.repoOwnedResponsibilityIds
    .filter((responsibilityId) => visibleEntityIds.has(responsibilityId))
    .sort((left, right) => left.localeCompare(right));

  const flowStatus = buildFlowStatusSummary({
    analysis,
    continuationAttempts,
  });

  return {
    analysis,
    state: {
      level0Doc: params.level0Doc,
      level0EdgeIds: params.level0Doc.relations.map((relation) => relation.id),
      activeFrontier: flowStatus.activeFrontier,
      terminatedNodes: flowStatus.terminatedNodes,
      refinementQueue: buildRefinementQueue({
        doc: params.level0Doc,
        visibleResponsibilityIds,
      }),
      edgeBindings: buildEdgeBindings({
        doc: params.level0Doc,
        expectations: params.expectations ?? [],
      }),
      visibleResponsibilityIds,
    },
  };
}

export function buildInheritedBoundaryFlowForResponsibility(params: {
  responsibilityId: string;
  expectations: EdgeExpectation[];
  ancestorDoc: SemanticDocument;
}): InheritedBoundaryFlow {
  const entityTypeById = buildEntityTypeById(params.ancestorDoc.entities);
  const inboundEdges = params.expectations
    .filter(
      (expectation) =>
        expectation.target.responsibilityId === params.responsibilityId ||
        expectation.target.candidateResponsibilityIds?.includes(params.responsibilityId),
    )
    .map((expectation) => ({
      edgeId: expectation.id,
      relationTypeId: expectation.kind,
      sourceId: expectation.source.responsibilityId,
      sourceTypeId: entityTypeById.get(expectation.source.responsibilityId),
      targetId: expectation.target.responsibilityId,
      targetTypeId: entityTypeById.get(expectation.target.responsibilityId),
    }))
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const outboundEdges = params.expectations
    .filter(
      (expectation) =>
        expectation.source.responsibilityId === params.responsibilityId ||
        expectation.source.candidateResponsibilityIds?.includes(params.responsibilityId),
    )
    .map((expectation) => ({
      edgeId: expectation.id,
      relationTypeId: expectation.kind,
      sourceId: expectation.source.responsibilityId,
      sourceTypeId: entityTypeById.get(expectation.source.responsibilityId),
      targetId: expectation.target.responsibilityId,
      targetTypeId: entityTypeById.get(expectation.target.responsibilityId),
    }))
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId));

  return {
    containerId: params.responsibilityId,
    inboundEdges,
    outboundEdges,
    ancestorDoc: params.ancestorDoc,
  };
}

export function serializeDocumentFlowAnalysisArtifact(
  analysis: DocumentFlowAnalysis,
): SerializedFlowAnalysis {
  return {
    entities: serializeEntityFlowAnalysis(analysis),
    relations: serializeRelationFlowAnalysis(analysis),
  };
}

export function serializeFlowBuildStateArtifact(state: FlowBuildState): SerializedFlowBuildState {
  return {
    level0EdgeIds: [...state.level0EdgeIds].sort((left, right) => left.localeCompare(right)),
    visibleResponsibilityIds: [...state.visibleResponsibilityIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    activeFrontier: sortFrontierEntries(state.activeFrontier),
    terminatedNodes: sortTerminatedEntries(state.terminatedNodes),
    refinementQueue: state.refinementQueue.map((entry) => ({
      containerId: entry.containerId,
      inboundEdges: [...entry.inboundEdges].sort((left, right) =>
        left.edgeId.localeCompare(right.edgeId),
      ),
      outboundEdges: [...entry.outboundEdges].sort((left, right) =>
        left.edgeId.localeCompare(right.edgeId),
      ),
    })),
    edgeBindings: [...state.edgeBindings].sort((left, right) => {
      const leftKey = `${left.level0EdgeId}:${left.endpoint}:${left.localId}`;
      const rightKey = `${right.level0EdgeId}:${right.endpoint}:${right.localId}`;
      return leftKey.localeCompare(rightKey);
    }),
  };
}

export function summarizeFlowBuildStateForPrompt(state: FlowBuildState): string {
  const lines: string[] = [];
  if (state.activeFrontier.length === 0) {
    lines.push('- Active frontier: none');
  } else {
    lines.push('- Active frontier:');
    for (const frontier of state.activeFrontier) {
      lines.push(
        `  - ${frontier.entityId} missing ${frontier.side}; flowRole=${frontier.flowRole}; mayTerminate=${frontier.mayTerminate}; attempts=${frontier.attemptCount}`,
      );
    }
  }

  if (state.terminatedNodes.length === 0) {
    lines.push('- Terminated nodes: none');
  } else {
    lines.push('- Terminated nodes:');
    for (const terminated of state.terminatedNodes) {
      lines.push(
        `  - ${terminated.entityId} terminated on ${terminated.side} (${terminated.reason})`,
      );
    }
  }

  if (state.edgeBindings.length === 0) {
    lines.push('- Edge refinements: none');
  } else {
    lines.push('- Edge refinements:');
    for (const binding of state.edgeBindings) {
      lines.push(
        `  - ${binding.level0EdgeId} ${binding.endpoint} -> ${binding.responsibilityId}/${binding.localId} (expectation ${binding.expectationId})`,
      );
    }
  }

  return lines.join('\n');
}

export function buildFlowRepairDiagnostics(params: {
  flowBuildState: FlowBuildState;
  analysis: DocumentFlowAnalysis;
  effectiveSchema: SchemaModule;
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const semantics = compileSchemaSemantics(params.effectiveSchema);

  for (const frontier of params.flowBuildState.activeFrontier) {
    const entityAnalysis = params.analysis.entitiesById.get(frontier.entityId);
    const sideLabel = frontier.side === 'ingress' ? 'incoming' : 'outgoing';
    diagnostics.push({
      domain: 'diagram',
      severity: frontier.mayTerminate ? 'warning' : 'error',
      phase: 'document',
      code:
        frontier.side === 'ingress'
          ? 'diagram.flow.unresolved_ingress'
          : 'diagram.flow.unresolved_egress',
      message: `${frontier.entityId} is missing ${sideLabel} flow at level 0`,
      entityId: frontier.entityId,
      hint: frontier.mayTerminate
        ? 'This node may terminate, but only after continuation has been attempted.'
        : `Continue the primary flow through ${frontier.entityId}.`,
      details: {
        flowRole: frontier.flowRole,
        mayTerminate: frontier.mayTerminate,
        attemptCount: frontier.attemptCount,
        fulfillment: entityAnalysis?.fulfillment,
      },
    });
  }

  for (const entityAnalysis of params.analysis.entitiesById.values()) {
    if (entityAnalysis.fulfillment.missingExpectedRelationIds.length === 0) {
      continue;
    }
    diagnostics.push({
      domain: 'diagram',
      severity: 'warning',
      phase: 'document',
      code: 'diagram.flow.missing_expected_relations',
      message: `${entityAnalysis.entityId} is missing expected relation types: ${entityAnalysis.fulfillment.missingExpectedRelationIds.join(', ')}`,
      entityId: entityAnalysis.entityId,
      details: {
        expectedRelationIds: entityAnalysis.fulfillment.missingExpectedRelationIds,
      },
    });
  }

  const visibleResponsibilityIds = new Set(params.flowBuildState.visibleResponsibilityIds);
  for (const entity of params.flowBuildState.level0Doc.entities) {
    if (!visibleResponsibilityIds.has(entity.id)) {
      continue;
    }
    const entityAnalysis = params.analysis.entitiesById.get(entity.id);
    if ((entityAnalysis?.contributingRelationIds.length ?? 0) > 0) {
      continue;
    }

    if (isGroupLikeType(semantics, entity.type)) {
      diagnostics.push({
        domain: 'diagram',
        severity: 'error',
        phase: 'document',
        code: 'diagram.flow.disconnected_top_level_group',
        message: `${entity.id} is a top-level grouping node with no incident level-0 relations`,
        entityId: entity.id,
        hint: 'Prefer a concrete runtime boundary at level 0, or connect this grouping node to the main flow before refining it.',
        details: {
          entityTypeId: entity.type,
          flowRole: entityAnalysis?.flowRole ?? 'none',
          contributingRelationIds: entityAnalysis?.contributingRelationIds ?? [],
        },
      });
      continue;
    }

    if (isPreferredTopLevelBoundaryWithoutFlow(params.effectiveSchema, semantics, entity.type)) {
      diagnostics.push({
        domain: 'diagram',
        severity: 'error',
        phase: 'document',
        code: 'diagram.flow.disconnected_top_level_boundary',
        message: `${entity.id} is a preferred top-level boundary with no incident level-0 relations or flow expectations`,
        entityId: entity.id,
        hint: 'Connect this boundary to the main flow, remove the redundant wrapper, or add trait-derived source/through/sink semantics to the schema type.',
        details: {
          entityTypeId: entity.type,
          topLevelBias: 'prefer',
          flowRole: entityAnalysis?.flowRole ?? 'none',
          contributingRelationIds: entityAnalysis?.contributingRelationIds ?? [],
        },
      });
    }
  }

  diagnostics.push(
    ...buildRefinedBoundaryDiagnostics({
      flowBuildState: params.flowBuildState,
      analysis: params.analysis,
    }),
  );

  return diagnostics.sort((left, right) => {
    const leftKey = `${left.entityId ?? ''}:${left.code}`;
    const rightKey = `${right.entityId ?? ''}:${right.code}`;
    return leftKey.localeCompare(rightKey);
  });
}

export function buildContinuationAttemptMap(
  previousAttempts: ReadonlyMap<string, number>,
  frontier: Level0PathFrontierEntry[],
): Map<string, number> {
  const next = new Map(previousAttempts);
  for (const entry of frontier) {
    const key = buildFrontierKey(entry.entityId, entry.side);
    next.set(key, (next.get(key) ?? 0) + 1);
  }
  return next;
}
