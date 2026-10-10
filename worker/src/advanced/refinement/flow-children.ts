import type { NodeRefinementResult } from '../types';

export function collectFlowRelevantChildIds(result: NodeRefinementResult): {
  refinedEdgeChildIds: Set<string>;
  relationChildIds: Set<string>;
  proposedEdgeChildIds: Set<string>;
  flowRelevantChildIds: Set<string>;
} {
  const refinedEdgeChildIds = new Set(
    result.edgeRefinements.flatMap((edgeRefinement) =>
      [edgeRefinement.fromChildLocalId, edgeRefinement.toChildLocalId].filter(
        (childLocalId): childLocalId is string => Boolean(childLocalId),
      ),
    ),
  );
  const relationChildIds = new Set(
    result.relations.flatMap((relation) => [relation.fromLocalId, relation.toLocalId]),
  );
  const proposedEdgeChildIds = new Set(
    (result.edgeProposals ?? []).map((edgeProposal) => edgeProposal.childLocalId),
  );
  return {
    refinedEdgeChildIds,
    relationChildIds,
    proposedEdgeChildIds,
    flowRelevantChildIds: new Set([
      ...refinedEdgeChildIds,
      ...relationChildIds,
      ...proposedEdgeChildIds,
    ]),
  };
}
