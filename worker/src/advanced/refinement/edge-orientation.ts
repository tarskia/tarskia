import type { SchemaSemantics } from '../../semantic';
import { isGroupLikeType } from '../refinement-helpers';
import type { InheritedNodeEdgeContract, NodeRefinementResult, NodeRefinementTask } from '../types';
import { buildEvidenceMatchedFlowEdgeRefinements } from './evidence';
import { collectFlowRelevantChildIds } from './flow-children';
import { collapseDegenerateTypedGroupRefinement } from './typed-groups';

export function matchInheritedEdge(
  edges: InheritedNodeEdgeContract[],
  endpoint: string,
  side: 'sourceId' | 'targetId',
  relationTypeId: string,
) {
  const endpointMatches = edges.filter((edge) => edge[side] === endpoint);
  const typedMatches = endpointMatches.filter((edge) => edge.relationTypeId === relationTypeId);
  const candidates = typedMatches.length > 0 ? typedMatches : endpointMatches;
  return { edge: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

export function normalizeEdgeRefinementOrientation(params: {
  semantics: SchemaSemantics;
  task: Pick<
    NodeRefinementTask,
    'nodeId' | 'inboundEdges' | 'outboundEdges' | 'groupMode' | 'groupTypeId'
  > &
    Partial<Pick<NodeRefinementTask, 'nodeName' | 'scope' | 'evidence'>>;
  result: NodeRefinementResult;
  inferEvidenceMatchedEdgeRefinements?: boolean;
}): NodeRefinementResult {
  const inferEvidenceMatchedEdgeRefinements = params.inferEvidenceMatchedEdgeRefinements ?? true;
  const inboundEdgeIds = new Set(params.task.inboundEdges.map((edge) => edge.id));
  const outboundEdgeIds = new Set(params.task.outboundEdges.map((edge) => edge.id));
  const originalChildLocalIds = new Set(params.result.children.map((child) => child.localId));

  const normalizeDirectChildEndpointFor = (
    endpoint: string,
    knownChildLocalIds: Set<string>,
  ): string => {
    if (knownChildLocalIds.has(endpoint)) {
      return endpoint;
    }
    const childPathPrefix = `${params.task.nodeId}/`;
    if (!endpoint.startsWith(childPathPrefix)) {
      return endpoint;
    }
    const localId = endpoint.slice(childPathPrefix.length);
    return localId && !localId.includes('/') && knownChildLocalIds.has(localId)
      ? localId
      : endpoint;
  };

  const normalizeOriginalDirectChildEndpoint = (endpoint: string): string =>
    normalizeDirectChildEndpointFor(endpoint, originalChildLocalIds);

  const inheritedEndpointMatchesChild = (entityId: string, childLocalId: string): boolean =>
    entityId === childLocalId || entityId.endsWith(`/${childLocalId}`);

  const duplicateBoundaryChildMatches = new Map<
    string,
    { edgeId: string; relationTypeId?: string; side: 'ingress' | 'egress' }
  >();
  if (params.task.groupMode === 'typed' && params.task.groupTypeId) {
    for (const child of params.result.children) {
      if (
        isGroupLikeType(params.semantics, child.typeId) ||
        child.typeId === params.task.groupTypeId
      ) {
        continue;
      }
      const matches = [
        ...params.task.inboundEdges
          .filter((edge) => inheritedEndpointMatchesChild(edge.sourceId, child.localId))
          .map((edge) => ({
            edgeId: edge.id,
            relationTypeId: edge.relationTypeId,
            side: 'ingress' as const,
          })),
        ...params.task.outboundEdges
          .filter((edge) => inheritedEndpointMatchesChild(edge.targetId, child.localId))
          .map((edge) => ({
            edgeId: edge.id,
            relationTypeId: edge.relationTypeId,
            side: 'egress' as const,
          })),
      ];
      if (matches.length === 1) {
        duplicateBoundaryChildMatches.set(child.localId, matches[0]);
      }
    }
  }

  const inferredBoundaryEdgeRefinements: NodeRefinementResult['edgeRefinements'] = [];
  const convertedBoundaryRelationIndexes = new Set<number>();
  const blockedDuplicateBoundaryChildIds = new Set<string>();
  const inputRelations = params.result.relations.map((relation) => ({
    ...relation,
    fromLocalId: normalizeOriginalDirectChildEndpoint(relation.fromLocalId),
    toLocalId: normalizeOriginalDirectChildEndpoint(relation.toLocalId),
  }));
  inputRelations.forEach((relation, index) => {
    const fromDuplicate = duplicateBoundaryChildMatches.get(relation.fromLocalId);
    const toDuplicate = duplicateBoundaryChildMatches.get(relation.toLocalId);
    const fromIsInternalChild = originalChildLocalIds.has(relation.fromLocalId) && !fromDuplicate;
    const toIsInternalChild = originalChildLocalIds.has(relation.toLocalId) && !toDuplicate;

    if (toDuplicate?.side === 'egress' && fromIsInternalChild) {
      inferredBoundaryEdgeRefinements.push({
        edgeId: toDuplicate.edgeId,
        relationTypeId:
          relation.typeId !== toDuplicate.relationTypeId ? relation.typeId : undefined,
        fromChildLocalId: relation.fromLocalId,
      });
      convertedBoundaryRelationIndexes.add(index);
      return;
    }

    if (fromDuplicate?.side === 'ingress' && toIsInternalChild) {
      inferredBoundaryEdgeRefinements.push({
        edgeId: fromDuplicate.edgeId,
        relationTypeId:
          relation.typeId !== fromDuplicate.relationTypeId ? relation.typeId : undefined,
        toChildLocalId: relation.toLocalId,
      });
      convertedBoundaryRelationIndexes.add(index);
      return;
    }

    if (fromDuplicate) {
      blockedDuplicateBoundaryChildIds.add(relation.fromLocalId);
    }
    if (toDuplicate) {
      blockedDuplicateBoundaryChildIds.add(relation.toLocalId);
    }
  });

  for (const edgeRefinement of params.result.edgeRefinements) {
    if (
      edgeRefinement.fromChildLocalId &&
      duplicateBoundaryChildMatches.has(edgeRefinement.fromChildLocalId)
    ) {
      blockedDuplicateBoundaryChildIds.add(edgeRefinement.fromChildLocalId);
    }
    if (
      edgeRefinement.toChildLocalId &&
      duplicateBoundaryChildMatches.has(edgeRefinement.toChildLocalId)
    ) {
      blockedDuplicateBoundaryChildIds.add(edgeRefinement.toChildLocalId);
    }
  }
  for (const edgeProposal of params.result.edgeProposals ?? []) {
    if (duplicateBoundaryChildMatches.has(edgeProposal.childLocalId)) {
      blockedDuplicateBoundaryChildIds.add(edgeProposal.childLocalId);
    }
  }

  const prunedDuplicateBoundaryChildIds = new Set(
    [...duplicateBoundaryChildMatches.keys()].filter(
      (childLocalId) => !blockedDuplicateBoundaryChildIds.has(childLocalId),
    ),
  );
  const children = params.result.children.filter(
    (child) => !prunedDuplicateBoundaryChildIds.has(child.localId),
  );
  const childLocalIds = new Set(children.map((child) => child.localId));
  const normalizeDirectChildEndpoint = (endpoint: string): string =>
    normalizeDirectChildEndpointFor(endpoint, childLocalIds);

  const edgeRefinements = params.result.edgeRefinements.map((edgeRefinement) => {
    const edgeId = edgeRefinement.edgeId;
    const inboundOnly = inboundEdgeIds.has(edgeId) && !outboundEdgeIds.has(edgeId);
    const outboundOnly = outboundEdgeIds.has(edgeId) && !inboundEdgeIds.has(edgeId);
    const fromChildLocalId = edgeRefinement.fromChildLocalId
      ? normalizeDirectChildEndpoint(edgeRefinement.fromChildLocalId)
      : undefined;
    const toChildLocalId = edgeRefinement.toChildLocalId
      ? normalizeDirectChildEndpoint(edgeRefinement.toChildLocalId)
      : undefined;
    const base = {
      edgeId,
      relationTypeId: edgeRefinement.relationTypeId,
    };

    if (outboundOnly) {
      const ownedChildLocalId =
        fromChildLocalId && childLocalIds.has(fromChildLocalId)
          ? fromChildLocalId
          : toChildLocalId && childLocalIds.has(toChildLocalId)
            ? toChildLocalId
            : (fromChildLocalId ?? toChildLocalId);
      return ownedChildLocalId
        ? {
            ...base,
            fromChildLocalId: ownedChildLocalId,
          }
        : base;
    }

    if (inboundOnly) {
      const ownedChildLocalId =
        toChildLocalId && childLocalIds.has(toChildLocalId)
          ? toChildLocalId
          : fromChildLocalId && childLocalIds.has(fromChildLocalId)
            ? fromChildLocalId
            : (toChildLocalId ?? fromChildLocalId);
      return ownedChildLocalId
        ? {
            ...base,
            toChildLocalId: ownedChildLocalId,
          }
        : base;
    }

    return {
      ...edgeRefinement,
      edgeId,
      fromChildLocalId,
      toChildLocalId,
    };
  });
  const edgeProposals = params.result.edgeProposals;

  const inferredEdgeRefinements: NodeRefinementResult['edgeRefinements'] = [];
  const relations = inputRelations
    .filter(
      (relation, index) =>
        !convertedBoundaryRelationIndexes.has(index) &&
        !prunedDuplicateBoundaryChildIds.has(relation.fromLocalId) &&
        !prunedDuplicateBoundaryChildIds.has(relation.toLocalId),
    )
    .flatMap((relation) => {
      const fromLocalId = normalizeDirectChildEndpoint(relation.fromLocalId);
      const toLocalId = normalizeDirectChildEndpoint(relation.toLocalId);
      const fromIsChild = childLocalIds.has(fromLocalId);
      const toIsChild = childLocalIds.has(toLocalId);

      if (fromIsChild && toIsChild) {
        return [{ ...relation, fromLocalId, toLocalId }];
      }

      if (fromIsChild && !toIsChild) {
        const { edge: inheritedEdge } = matchInheritedEdge(
          params.task.outboundEdges,
          toLocalId,
          'targetId',
          relation.typeId,
        );
        if (inheritedEdge) {
          inferredEdgeRefinements.push({
            edgeId: inheritedEdge.id,
            relationTypeId:
              relation.typeId !== inheritedEdge.relationTypeId ? relation.typeId : undefined,
            fromChildLocalId: fromLocalId,
          });
          return [];
        }
      }

      if (!fromIsChild && toIsChild) {
        const { edge: inheritedEdge } = matchInheritedEdge(
          params.task.inboundEdges,
          fromLocalId,
          'sourceId',
          relation.typeId,
        );
        if (inheritedEdge) {
          inferredEdgeRefinements.push({
            edgeId: inheritedEdge.id,
            relationTypeId:
              relation.typeId !== inheritedEdge.relationTypeId ? relation.typeId : undefined,
            toChildLocalId: toLocalId,
          });
          return [];
        }
      }

      return [{ ...relation, fromLocalId, toLocalId }];
    });

  const collapsed = collapseDegenerateTypedGroupRefinement({
    semantics: params.semantics,
    task: params.task,
    children,
    relations,
    edgeRefinements: [
      ...edgeRefinements,
      ...inferredBoundaryEdgeRefinements,
      ...inferredEdgeRefinements,
    ],
    edgeProposals,
  });

  const flowRelevantChildIds = collectFlowRelevantChildIds({
    ...params.result,
    children: collapsed.children,
    relations: collapsed.relations,
    edgeRefinements: collapsed.edgeRefinements,
    edgeProposals: collapsed.edgeProposals,
  }).flowRelevantChildIds;
  const evidenceMatchedEdgeRefinements: NodeRefinementResult['edgeRefinements'] =
    inferEvidenceMatchedEdgeRefinements
      ? collapsed.children
          .filter(
            (child) => child.queueDecision === 'expand' && !flowRelevantChildIds.has(child.localId),
          )
          .flatMap((child) =>
            buildEvidenceMatchedFlowEdgeRefinements({ task: params.task, child }).map(
              (suggestion) => ({
                edgeId: suggestion.edgeId,
                relationTypeId: undefined,
                fromChildLocalId:
                  suggestion.endpoint === 'from' ? suggestion.childLocalId : undefined,
                toChildLocalId: suggestion.endpoint === 'to' ? suggestion.childLocalId : undefined,
              }),
            ),
          )
      : [];

  const edgeRefinementKeys = new Set<string>();
  const dedupedEdgeRefinements = [
    ...collapsed.edgeRefinements,
    ...evidenceMatchedEdgeRefinements,
  ].filter((edgeRefinement) => {
    const key = JSON.stringify([
      edgeRefinement.edgeId,
      edgeRefinement.relationTypeId ?? null,
      edgeRefinement.fromChildLocalId ?? null,
      edgeRefinement.toChildLocalId ?? null,
    ]);
    if (edgeRefinementKeys.has(key)) {
      return false;
    }
    edgeRefinementKeys.add(key);
    return true;
  });

  return {
    ...params.result,
    children: collapsed.children,
    relations: collapsed.relations,
    edgeRefinements: dedupedEdgeRefinements,
    edgeProposals: collapsed.edgeProposals,
  };
}
