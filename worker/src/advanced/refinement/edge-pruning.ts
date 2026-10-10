import {
  type Diagnostic,
  diagramDiagnostic,
  getAllowedRelationTypeIds,
  type SchemaModule,
  type SchemaSemantics,
} from '../../semantic';
import { dedupeEdgeProposals, isGroupLikeType } from '../refinement-helpers';
import type { ActiveEdgeProposal, NodeRefinementResult, NodeRefinementTask } from '../types';
import { collectFlowRelevantChildIds } from './flow-children';
import {
  getInheritedEdgeRefinementEndpointTypes,
  relationTypeIsValidForEndpoints,
} from './inherited-edges';

export type RecoveredEdgeProposal = NonNullable<NodeRefinementResult['edgeProposals']>[number];

export type LocalRelationSpec = NodeRefinementResult['relations'][number];

export interface InvalidLocalRelation {
  relation: LocalRelationSpec;
  reason: 'missing_endpoint' | 'invalid_relation_type';
  fromTypeId?: string;
  toTypeId?: string;
  validRelationTypeIds?: string[];
}

export function pruneInvalidEdgeRefinements(params: {
  task: NodeRefinementTask;
  result: NodeRefinementResult;
  schema: SchemaModule;
  semantics: SchemaSemantics;
  activeEdgeProposals?: ActiveEdgeProposal[];
}): NodeRefinementResult {
  const childByLocalId = new Map(
    params.result.children.map((child) => [child.localId, child] as const),
  );
  const inheritedEdgeById = new Map(
    [...params.task.inboundEdges, ...params.task.outboundEdges].map(
      (edge) => [edge.id, edge] as const,
    ),
  );
  const invalidEdgeRefinementChildIds = new Set<string>();
  let changed = false;
  const recoveredEdgeProposals: RecoveredEdgeProposal[] = [];
  const addRecoverableGroupEndpointProposal = (input: {
    edgeId: string;
    endpoint: 'from' | 'to';
    childLocalId?: string;
  }): boolean => {
    const child = input.childLocalId ? childByLocalId.get(input.childLocalId) : undefined;
    if (!child || !isGroupLikeType(params.semantics, child.typeId)) {
      return false;
    }
    recoveredEdgeProposals.push({
      edgeId: input.edgeId,
      endpoint: input.endpoint,
      childLocalId: child.localId,
    });
    return true;
  };

  const edgeRefinements = params.result.edgeRefinements.flatMap((edgeRefinement) => {
    const inheritedEdge = inheritedEdgeById.get(edgeRefinement.edgeId);
    if (!inheritedEdge) {
      return [edgeRefinement];
    }
    if (
      (edgeRefinement.fromChildLocalId && !childByLocalId.has(edgeRefinement.fromChildLocalId)) ||
      (edgeRefinement.toChildLocalId && !childByLocalId.has(edgeRefinement.toChildLocalId))
    ) {
      return [edgeRefinement];
    }

    const { sourceTypeId, targetTypeId } = getInheritedEdgeRefinementEndpointTypes({
      edgeRefinement,
      inheritedEdge,
      childByLocalId,
      activeEdgeProposals: params.activeEdgeProposals,
    });
    const selectedRelationTypeId = edgeRefinement.relationTypeId ?? inheritedEdge.relationTypeId;
    if (!sourceTypeId || !targetTypeId || !selectedRelationTypeId) {
      return [edgeRefinement];
    }
    if (
      relationTypeIsValidForEndpoints({
        schema: params.schema,
        semantics: params.semantics,
        fromTypeId: sourceTypeId,
        toTypeId: targetTypeId,
        relationTypeId: selectedRelationTypeId,
      })
    ) {
      return [edgeRefinement];
    }
    if (
      edgeRefinement.relationTypeId &&
      inheritedEdge.relationTypeId &&
      relationTypeIsValidForEndpoints({
        schema: params.schema,
        semantics: params.semantics,
        fromTypeId: sourceTypeId,
        toTypeId: targetTypeId,
        relationTypeId: inheritedEdge.relationTypeId,
      })
    ) {
      changed = true;
      return [{ ...edgeRefinement, relationTypeId: undefined }];
    }

    changed = true;
    const convertedSourceToProposal = addRecoverableGroupEndpointProposal({
      edgeId: edgeRefinement.edgeId,
      endpoint: 'from',
      childLocalId: edgeRefinement.fromChildLocalId,
    });
    const convertedTargetToProposal = addRecoverableGroupEndpointProposal({
      edgeId: edgeRefinement.edgeId,
      endpoint: 'to',
      childLocalId: edgeRefinement.toChildLocalId,
    });
    const convertedToProposal = convertedSourceToProposal || convertedTargetToProposal;
    if (!convertedToProposal && edgeRefinement.fromChildLocalId) {
      invalidEdgeRefinementChildIds.add(edgeRefinement.fromChildLocalId);
    }
    if (!convertedToProposal && edgeRefinement.toChildLocalId) {
      invalidEdgeRefinementChildIds.add(edgeRefinement.toChildLocalId);
    }
    return [];
  });

  if (!changed) {
    return params.result;
  }

  const parentIsGroupLike = isGroupLikeType(params.semantics, params.task.nodeTypeId);
  const edgeProposals = dedupeEdgeProposals([
    ...(params.result.edgeProposals ?? []),
    ...recoveredEdgeProposals,
  ]);
  const { flowRelevantChildIds } = collectFlowRelevantChildIds({
    ...params.result,
    edgeRefinements,
    edgeProposals,
  });
  const children = parentIsGroupLike
    ? params.result.children
    : params.result.children.filter((child) => {
        if (!invalidEdgeRefinementChildIds.has(child.localId)) {
          return true;
        }
        if (!isGroupLikeType(params.semantics, child.typeId)) {
          return true;
        }
        return flowRelevantChildIds.has(child.localId);
      });
  const removedChildLocalIds = new Set(
    params.result.children
      .filter(
        (child) => !children.some((remainingChild) => remainingChild.localId === child.localId),
      )
      .map((child) => child.localId),
  );

  return {
    ...params.result,
    children,
    relations: params.result.relations.filter(
      (relation) =>
        !removedChildLocalIds.has(relation.fromLocalId) &&
        !removedChildLocalIds.has(relation.toLocalId),
    ),
    edgeRefinements: edgeRefinements.filter(
      (edgeRefinement) =>
        !(
          (edgeRefinement.fromChildLocalId &&
            removedChildLocalIds.has(edgeRefinement.fromChildLocalId)) ||
          (edgeRefinement.toChildLocalId && removedChildLocalIds.has(edgeRefinement.toChildLocalId))
        ),
    ),
    edgeProposals:
      edgeProposals.length > 0
        ? edgeProposals.filter(
            (edgeProposal) => !removedChildLocalIds.has(edgeProposal.childLocalId),
          )
        : params.result.edgeProposals,
  };
}

export function collectInvalidLocalRelations(params: {
  result: NodeRefinementResult;
  schema: SchemaModule;
  semantics: SchemaSemantics;
}): InvalidLocalRelation[] {
  const childByLocalId = new Map(
    params.result.children.map((child) => [child.localId, child] as const),
  );
  const invalidRelations: InvalidLocalRelation[] = [];

  for (const relation of params.result.relations) {
    const fromChild = childByLocalId.get(relation.fromLocalId);
    const toChild = childByLocalId.get(relation.toLocalId);
    if (!fromChild || !toChild) {
      invalidRelations.push({
        relation,
        reason: 'missing_endpoint',
        fromTypeId: fromChild?.typeId,
        toTypeId: toChild?.typeId,
      });
      continue;
    }

    const validRelationTypeIds = getAllowedRelationTypeIds({
      schema: params.schema,
      semantics: params.semantics,
      fromTypeId: fromChild.typeId,
      toTypeId: toChild.typeId,
    }).sort((left, right) => left.localeCompare(right));
    if (!validRelationTypeIds.includes(relation.typeId)) {
      invalidRelations.push({
        relation,
        reason: 'invalid_relation_type',
        fromTypeId: fromChild.typeId,
        toTypeId: toChild.typeId,
        validRelationTypeIds,
      });
    }
  }

  return invalidRelations;
}

export function pruneInvalidLocalRelations(params: {
  result: NodeRefinementResult;
  schema: SchemaModule;
  semantics: SchemaSemantics;
}): NodeRefinementResult {
  const invalidRelationIds = new Set(
    collectInvalidLocalRelations(params).map(({ relation }) => relation.localId),
  );
  if (invalidRelationIds.size === 0) {
    return params.result;
  }

  return {
    ...params.result,
    relations: params.result.relations.filter(
      (relation) => !invalidRelationIds.has(relation.localId),
    ),
  };
}

export function formatInvalidLocalRelationSummary(invalidRelation: InvalidLocalRelation): string {
  const endpointSummary =
    invalidRelation.fromTypeId && invalidRelation.toTypeId
      ? `${invalidRelation.fromTypeId} -> ${invalidRelation.toTypeId}`
      : `missing endpoint ${invalidRelation.relation.fromLocalId} -> ${invalidRelation.relation.toLocalId}`;
  const allowedSummary =
    invalidRelation.reason === 'invalid_relation_type'
      ? invalidRelation.validRelationTypeIds && invalidRelation.validRelationTypeIds.length > 0
        ? `; allowed relation types: ${invalidRelation.validRelationTypeIds.join(', ')}`
        : '; no relation types are valid for those endpoints'
      : '';
  return `${invalidRelation.relation.localId} (${invalidRelation.relation.typeId} for ${endpointSummary}${allowedSummary})`;
}

export function buildPrunedLocalRelationDiagnostics(params: {
  task: NodeRefinementTask;
  invalidRelations: InvalidLocalRelation[];
}): Diagnostic[] {
  return params.invalidRelations.map((invalidRelation) =>
    diagramDiagnostic({
      phase: 'document',
      severity: 'warning',
      code: 'diagram.node_refinement.pruned_invalid_local_relation',
      entityId: params.task.nodeId,
      relationId: invalidRelation.relation.localId,
      message: `Pruned invalid local relation under ${params.task.nodeId} after repair attempts: ${formatInvalidLocalRelationSummary(invalidRelation)}`,
      details: {
        relationAnalysis: {
          fromRef: invalidRelation.relation.fromLocalId,
          fromType: invalidRelation.fromTypeId,
          toRef: invalidRelation.relation.toLocalId,
          toType: invalidRelation.toTypeId,
          selectedType: invalidRelation.relation.typeId,
          validRelationTypes: invalidRelation.validRelationTypeIds ?? [],
          reason: invalidRelation.reason,
        },
      },
    }),
  );
}
