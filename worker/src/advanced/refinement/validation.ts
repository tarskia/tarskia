import {
  type Diagnostic,
  diagramDiagnostic,
  getAllowedRelationTypeIds,
  sortDiagnostics,
} from '../../semantic';
import type { InheritedNodeEdgeContract } from '../types';
import { isSameOrDescendantNodeId } from './edge-contracts';
import {
  buildUnrefinedInheritedEdgeSuggestions,
  getInheritedEdgeRefinementEndpointTypes,
} from './inherited-edges';
import {
  MAX_REFINED_EDGES_PER_INHERITED_EDGE,
  UNREFINED_INHERITED_EDGE_DIAGNOSTIC_CODE,
} from './schema-context';
import { validateChildren } from './validation-children';
import { createValidationContext, type NodeValidationParams } from './validation-context';
import { validateLocalRelations } from './validation-relations';

export function validateNodeRefinementSemantics(params: NodeValidationParams): Diagnostic[] {
  const context = createValidationContext(params);
  const { diagnostics, childByLocalId, inboundEdgeIds, outboundEdgeIds } = context;
  validateChildren(context);
  validateLocalRelations(context);

  const allInheritedEdgeIds = new Set([...inboundEdgeIds, ...outboundEdgeIds]);
  const inheritedEdgeById = new Map(
    [...params.task.inboundEdges, ...params.task.outboundEdges].map(
      (edge) => [edge.id, edge] as const,
    ),
  );
  for (const edgeRefinement of params.result.edgeRefinements) {
    if (!allInheritedEdgeIds.has(edgeRefinement.edgeId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_edge_refinement_edge',
          entityId: params.task.nodeId,
          message: `Edge refinement for ${edgeRefinement.edgeId} does not reference an inherited edge of ${params.task.nodeId}`,
        }),
      );
      continue;
    }
    if (edgeRefinement.fromChildLocalId && !childByLocalId.has(edgeRefinement.fromChildLocalId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.edge_refinement_missing_source_child',
          entityId: params.task.nodeId,
          message: `Edge refinement for ${edgeRefinement.edgeId} targets missing source child ${edgeRefinement.fromChildLocalId}`,
        }),
      );
    }
    if (edgeRefinement.toChildLocalId && !childByLocalId.has(edgeRefinement.toChildLocalId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.edge_refinement_missing_target_child',
          entityId: params.task.nodeId,
          message: `Edge refinement for ${edgeRefinement.edgeId} targets missing target child ${edgeRefinement.toChildLocalId}`,
        }),
      );
    }
    if (edgeRefinement.fromChildLocalId && !outboundEdgeIds.has(edgeRefinement.edgeId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_outbound_edge_refinement',
          entityId: params.task.nodeId,
          message: `Edge refinement for ${edgeRefinement.edgeId} cannot rewrite the source side of ${params.task.nodeId}`,
        }),
      );
    }
    if (edgeRefinement.toChildLocalId && !inboundEdgeIds.has(edgeRefinement.edgeId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_inbound_edge_refinement',
          entityId: params.task.nodeId,
          message: `Edge refinement for ${edgeRefinement.edgeId} cannot rewrite the target side of ${params.task.nodeId}`,
        }),
      );
    }

    const inheritedEdge = inheritedEdgeById.get(edgeRefinement.edgeId);
    const endpointTypes = inheritedEdge
      ? getInheritedEdgeRefinementEndpointTypes({
          edgeRefinement,
          inheritedEdge,
          childByLocalId,
          activeEdgeProposals: params.activeEdgeProposals,
        })
      : {};
    const { sourceTypeId, targetTypeId } = endpointTypes;
    const selectedRelationTypeId = edgeRefinement.relationTypeId ?? inheritedEdge?.relationTypeId;
    if (sourceTypeId && targetTypeId && selectedRelationTypeId) {
      const validRelationTypeIds = getAllowedRelationTypeIds({
        schema: params.schema,
        semantics: params.semantics,
        fromTypeId: sourceTypeId,
        toTypeId: targetTypeId,
      });
      if (!validRelationTypeIds.includes(selectedRelationTypeId)) {
        diagnostics.push(
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.node_refinement.invalid_edge_refinement_relation_type',
            entityId: params.task.nodeId,
            relationId: edgeRefinement.edgeId,
            message: `Edge refinement for ${edgeRefinement.edgeId} uses invalid relation type ${selectedRelationTypeId} for ${sourceTypeId} -> ${targetTypeId}`,
            details: {
              relationAnalysis: {
                fromRef: edgeRefinement.fromChildLocalId ?? params.task.nodeId,
                fromType: sourceTypeId,
                toRef: edgeRefinement.toChildLocalId ?? params.task.nodeId,
                toType: targetTypeId,
                selectedType: selectedRelationTypeId,
                validRelationTypes: validRelationTypeIds,
                originalRelationType: inheritedEdge?.relationTypeId,
              },
            },
          }),
        );
      }
    }
  }

  const activeEdgeProposalsByKey = new Map(
    (params.activeEdgeProposals ?? []).map(
      (proposal) => [`${proposal.edgeId}:${proposal.endpoint}`, proposal] as const,
    ),
  );
  for (const edgeProposal of params.result.edgeProposals ?? []) {
    if (!allInheritedEdgeIds.has(edgeProposal.edgeId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_edge_proposal_edge',
          entityId: params.task.nodeId,
          message: `Edge proposal for ${edgeProposal.edgeId} does not reference an inherited edge of ${params.task.nodeId}`,
        }),
      );
      continue;
    }
    if (!childByLocalId.has(edgeProposal.childLocalId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.edge_proposal_missing_child',
          entityId: params.task.nodeId,
          message: `Edge proposal for ${edgeProposal.edgeId} targets missing child ${edgeProposal.childLocalId}`,
        }),
      );
      continue;
    }
    if (edgeProposal.endpoint === 'from' && !outboundEdgeIds.has(edgeProposal.edgeId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_outbound_edge_proposal',
          entityId: params.task.nodeId,
          message: `Edge proposal for ${edgeProposal.edgeId} cannot rewrite the source side of ${params.task.nodeId}`,
        }),
      );
      continue;
    }
    if (edgeProposal.endpoint === 'to' && !inboundEdgeIds.has(edgeProposal.edgeId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_inbound_edge_proposal',
          entityId: params.task.nodeId,
          message: `Edge proposal for ${edgeProposal.edgeId} cannot rewrite the target side of ${params.task.nodeId}`,
        }),
      );
      continue;
    }
    const inheritedEdge = inheritedEdgeById.get(edgeProposal.edgeId);
    const sourceTypeId =
      edgeProposal.endpoint === 'from'
        ? childByLocalId.get(edgeProposal.childLocalId)?.typeId
        : inheritedEdge?.sourceTypeId;
    const targetTypeId =
      edgeProposal.endpoint === 'to'
        ? childByLocalId.get(edgeProposal.childLocalId)?.typeId
        : inheritedEdge?.targetTypeId;
    const selectedRelationTypeId = edgeProposal.relationTypeId ?? inheritedEdge?.relationTypeId;
    if (sourceTypeId && targetTypeId && selectedRelationTypeId) {
      const validRelationTypeIds = getAllowedRelationTypeIds({
        schema: params.schema,
        semantics: params.semantics,
        fromTypeId: sourceTypeId,
        toTypeId: targetTypeId,
      });
      if (!validRelationTypeIds.includes(selectedRelationTypeId)) {
        const overridesRelationType =
          edgeProposal.relationTypeId !== undefined &&
          edgeProposal.relationTypeId !== inheritedEdge?.relationTypeId;
        diagnostics.push(
          diagramDiagnostic({
            phase: 'document',
            severity: overridesRelationType ? 'error' : 'warning',
            code: overridesRelationType
              ? 'diagram.node_refinement.invalid_edge_proposal_relation_type'
              : 'diagram.node_refinement.pending_edge_proposal_relation_type',
            entityId: params.task.nodeId,
            relationId: edgeProposal.edgeId,
            message: overridesRelationType
              ? `Edge proposal for ${edgeProposal.edgeId} uses invalid relation type ${selectedRelationTypeId} for ${sourceTypeId} -> ${targetTypeId}`
              : `Edge proposal for ${edgeProposal.edgeId} is provisional against the unresolved opposite endpoint: ${selectedRelationTypeId} is not currently valid for ${sourceTypeId} -> ${targetTypeId}`,
          }),
        );
      }
    }

    const activeProposal = activeEdgeProposalsByKey.get(
      `${edgeProposal.edgeId}:${edgeProposal.endpoint}`,
    );
    if (
      activeProposal &&
      !isSameOrDescendantNodeId(
        `${params.task.nodeId}/${edgeProposal.childLocalId}`,
        activeProposal.childId,
      )
    ) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.edge_proposal_not_narrowing',
          entityId: params.task.nodeId,
          relationId: edgeProposal.edgeId,
          message: `Edge proposal for ${edgeProposal.edgeId} must narrow the existing ${edgeProposal.endpoint} proposal from ${activeProposal.childId}`,
        }),
      );
    }
  }

  const hasOwnedEdgeRefinement = (edgeId: string, endpoint: 'from' | 'to'): boolean =>
    params.result.edgeRefinements.some(
      (edgeRefinement) =>
        edgeRefinement.edgeId === edgeId &&
        (endpoint === 'from'
          ? Boolean(edgeRefinement.fromChildLocalId)
          : Boolean(edgeRefinement.toChildLocalId)),
    );
  const hasOwnedEdgeProposal = (edgeId: string, endpoint: 'from' | 'to'): boolean =>
    (params.result.edgeProposals ?? []).some(
      (edgeProposal) => edgeProposal.edgeId === edgeId && edgeProposal.endpoint === endpoint,
    );
  const inheritedEndpointChecks: Array<{
    edge: InheritedNodeEdgeContract;
    endpoint: 'from' | 'to';
  }> = [
    ...params.task.inboundEdges.map((edge) => ({ edge, endpoint: 'to' as const })),
    ...params.task.outboundEdges.map((edge) => ({ edge, endpoint: 'from' as const })),
  ];
  for (const { edge, endpoint } of inheritedEndpointChecks) {
    if (
      hasOwnedEdgeRefinement(edge.id, endpoint) ||
      hasOwnedEdgeProposal(edge.id, endpoint) ||
      params.result.children.length === 0
    ) {
      continue;
    }
    const suggestedEdgeRefinements = buildUnrefinedInheritedEdgeSuggestions({
      edge,
      endpoint,
      children: params.result.children,
      schema: params.schema,
      semantics: params.semantics,
      activeEdgeProposals: params.activeEdgeProposals,
    });
    if (suggestedEdgeRefinements.length === 0) {
      continue;
    }
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'warning',
        code: UNREFINED_INHERITED_EDGE_DIAGNOSTIC_CODE,
        entityId: params.task.nodeId,
        relationId: edge.id,
        message: `Inherited ${endpoint} edge ${edge.id} remains attached to ${params.task.nodeId} even though direct child evidence overlaps the edge evidence`,
        hint: 'Use a suggested edgeRefinement when the child carries this inherited flow; otherwise return a smaller child forest or narrower child evidence.',
        details: {
          suggestedEdgeRefinements,
        },
      }),
    );
  }

  const edgeRefinementCounts = new Map<string, number>();
  for (const edgeRefinement of params.result.edgeRefinements) {
    edgeRefinementCounts.set(
      edgeRefinement.edgeId,
      (edgeRefinementCounts.get(edgeRefinement.edgeId) ?? 0) + 1,
    );
  }

  for (const [edgeId, refinementCount] of edgeRefinementCounts.entries()) {
    if (refinementCount <= MAX_REFINED_EDGES_PER_INHERITED_EDGE) {
      continue;
    }
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'warning',
        code: 'diagram.node_refinement.edge_refinement_soft_cap_exceeded',
        entityId: params.task.nodeId,
        message: `${params.task.nodeId} refines ${edgeId} into ${refinementCount} descendant edges; prefer a smaller set of representative flow carriers`,
        details: {
          refinementCount,
          maxRefinedEdgesPerInheritedEdge: MAX_REFINED_EDGES_PER_INHERITED_EDGE,
        },
      }),
    );
  }

  return sortDiagnostics(diagnostics);
}
