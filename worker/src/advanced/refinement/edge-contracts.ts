import { createHash } from 'node:crypto';
import { dedupeEdgeContracts } from '../refinement-helpers';
import type {
  ActiveEdgeProposal,
  NodeRefinementResult,
  RefinableEdgeContract,
  RefinedChildNode,
} from '../types';

export function isSameOrDescendantNodeId(nodeId: string, ancestorNodeId: string): boolean {
  return nodeId === ancestorNodeId || nodeId.startsWith(`${ancestorNodeId}/`);
}

export function buildActiveEdgeProposalMap(
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

export type EdgeIdentity = Pick<RefinableEdgeContract, 'relationTypeId' | 'sourceId' | 'targetId'>;

export function buildEdgeId(edge: EdgeIdentity, usedIds: Map<string, EdgeIdentity>): string {
  const segments = [
    ...(edge.relationTypeId === undefined ? [] : [edge.relationTypeId.split('.').at(-1)!]),
    edge.sourceId.split('/').at(-1)!,
    'to',
    edge.targetId.split('/').at(-1)!,
  ];
  const baseId = segments.map((segment) => segment.replace(/[^a-zA-Z0-9_-]+/g, '-')).join('--');
  const conflicts = (id: string) => {
    const existing = usedIds.get(id);
    return (
      existing !== undefined &&
      (existing.relationTypeId !== edge.relationTypeId ||
        existing.sourceId !== edge.sourceId ||
        existing.targetId !== edge.targetId)
    );
  };
  let id = baseId;
  if (conflicts(id)) {
    const hash = createHash('sha256')
      .update(`${edge.relationTypeId ?? ''}|${edge.sourceId}|${edge.targetId}`)
      .digest('hex')
      .slice(0, 8);
    id = `${baseId}--${hash}`;
    // Keep IDs unique even if a retained ID already occupies the hash fallback.
    for (let suffix = 2; conflicts(id); suffix += 1) {
      id = `${baseId}--${hash}--${suffix}`;
    }
  }
  usedIds.set(id, edge);
  return id;
}

export function expandRefinedEdgeContracts(params: {
  edgeContracts: RefinableEdgeContract[];
  result: NodeRefinementResult;
  childEntities: RefinedChildNode[];
  activeEdgeProposals: ActiveEdgeProposal[];
  usedIds: Map<string, EdgeIdentity>;
}): {
  edgeContracts: RefinableEdgeContract[];
  appliedEdgeRefinements: Array<{
    edgeId: string;
    refinedEdgeId: string;
    relationTypeId?: string;
    sourceId: string;
    targetId: string;
  }>;
  consumedEdgeProposals: Array<{ edgeId: string; endpoint: 'from' | 'to' }>;
} {
  const childByLocalId = new Map(
    params.childEntities.map((child) => [child.localId, child] as const),
  );
  const activeEdgeProposalMap = buildActiveEdgeProposalMap(params.activeEdgeProposals);
  const edgeRefinementsByEdgeId = new Map<string, NodeRefinementResult['edgeRefinements']>();
  for (const edgeRefinement of params.result.edgeRefinements) {
    const current = edgeRefinementsByEdgeId.get(edgeRefinement.edgeId) ?? [];
    edgeRefinementsByEdgeId.set(edgeRefinement.edgeId, [...current, edgeRefinement]);
  }

  const nextEdgeContracts: RefinableEdgeContract[] = [];
  const appliedEdgeRefinements: Array<{
    edgeId: string;
    refinedEdgeId: string;
    relationTypeId?: string;
    sourceId: string;
    targetId: string;
  }> = [];
  const consumedEdgeProposals: Array<{ edgeId: string; endpoint: 'from' | 'to' }> = [];

  const expansions: { edge: RefinableEdgeContract; refinedContracts: RefinableEdgeContract[] }[] =
    [];
  for (const edge of params.edgeContracts) {
    const edgeRefinements = edgeRefinementsByEdgeId.get(edge.id);
    if (!edgeRefinements || edgeRefinements.length === 0) {
      params.usedIds.set(edge.id, edge);
      expansions.push({ edge, refinedContracts: [] });
      continue;
    }

    const refinedContracts = dedupeEdgeContracts(
      edgeRefinements.map((edgeRefinement) => {
        const proposalEndpoints = activeEdgeProposalMap.get(edgeRefinement.edgeId);
        const matchedSourceProposal =
          !edgeRefinement.fromChildLocalId && edgeRefinement.toChildLocalId
            ? proposalEndpoints?.from
            : undefined;
        const matchedTargetProposal =
          edgeRefinement.fromChildLocalId && !edgeRefinement.toChildLocalId
            ? proposalEndpoints?.to
            : undefined;
        if (matchedSourceProposal) {
          consumedEdgeProposals.push({ edgeId: edgeRefinement.edgeId, endpoint: 'from' });
        }
        if (matchedTargetProposal) {
          consumedEdgeProposals.push({ edgeId: edgeRefinement.edgeId, endpoint: 'to' });
        }
        return {
          id: edge.id,
          relationTypeId: edgeRefinement.relationTypeId ?? edge.relationTypeId,
          description: edge.description,
          sourceId: edgeRefinement.fromChildLocalId
            ? (childByLocalId.get(edgeRefinement.fromChildLocalId)?.id ?? edge.sourceId)
            : (matchedSourceProposal?.childId ?? edge.sourceId),
          sourceTypeId: edgeRefinement.fromChildLocalId
            ? (childByLocalId.get(edgeRefinement.fromChildLocalId)?.typeId ?? edge.sourceTypeId)
            : (matchedSourceProposal?.childTypeId ?? edge.sourceTypeId),
          targetId: edgeRefinement.toChildLocalId
            ? (childByLocalId.get(edgeRefinement.toChildLocalId)?.id ?? edge.targetId)
            : (matchedTargetProposal?.childId ?? edge.targetId),
          targetTypeId: edgeRefinement.toChildLocalId
            ? (childByLocalId.get(edgeRefinement.toChildLocalId)?.typeId ?? edge.targetTypeId)
            : (matchedTargetProposal?.childTypeId ?? edge.targetTypeId),
          evidence: edge.evidence,
          provenancePath: edge.provenancePath,
        };
      }),
    );

    // Reserve all retained IDs before allocating any split IDs, regardless of edge order.
    if (refinedContracts.length === 1) {
      params.usedIds.set(edge.id, refinedContracts[0]);
    }
    expansions.push({ edge, refinedContracts });
  }

  for (const { edge, refinedContracts } of expansions) {
    if (refinedContracts.length === 0) {
      nextEdgeContracts.push(edge);
      continue;
    }
    for (const refinedContract of refinedContracts) {
      const split = refinedContracts.length > 1;
      const refinedEdgeId = split ? buildEdgeId(refinedContract, params.usedIds) : edge.id;
      nextEdgeContracts.push({
        ...refinedContract,
        id: refinedEdgeId,
        ...(split ? { refines: edge.id } : edge.refines ? { refines: edge.refines } : {}),
      });
      appliedEdgeRefinements.push({
        edgeId: edge.id,
        refinedEdgeId,
        relationTypeId: refinedContract.relationTypeId,
        sourceId: refinedContract.sourceId,
        targetId: refinedContract.targetId,
      });
    }
  }

  return {
    edgeContracts: dedupeEdgeContracts(nextEdgeContracts),
    appliedEdgeRefinements,
    consumedEdgeProposals,
  };
}

export function createInternalEdgeContracts(params: {
  usedIds: Map<string, EdgeIdentity>;
  result: NodeRefinementResult;
  childEntities: RefinedChildNode[];
}): RefinableEdgeContract[] {
  const childByLocalId = new Map(
    params.childEntities.map((child) => [child.localId, child] as const),
  );
  return params.result.relations
    .map((relation): RefinableEdgeContract | undefined => {
      const fromChild = childByLocalId.get(relation.fromLocalId);
      const toChild = childByLocalId.get(relation.toLocalId);
      if (!fromChild || !toChild) {
        return undefined;
      }
      return {
        id: buildEdgeId(
          { relationTypeId: relation.typeId, sourceId: fromChild.id, targetId: toChild.id },
          params.usedIds,
        ),
        relationTypeId: relation.typeId,
        description: relation.description,
        sourceId: fromChild.id,
        sourceTypeId: fromChild.typeId,
        targetId: toChild.id,
        targetTypeId: toChild.typeId,
        evidence: relation.evidence,
      } satisfies RefinableEdgeContract;
    })
    .filter((edge): edge is RefinableEdgeContract => edge !== undefined);
}
