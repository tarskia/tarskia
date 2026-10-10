import type { Entity, Relation, SchemaSemantics } from '../../semantic';
import { buildPlanSupportForEntity } from '../concept-plan';
import { isGroupLikeType } from '../refinement-helpers';
import type {
  ActiveEdgeProposal,
  AreaPlan,
  AreaPlanEvidence,
  GroupMode,
  NodeRefinementTask,
  RefinableEdgeContract,
  RefinedChildNode,
} from '../types';
import { buildActiveEdgeProposalMap } from './edge-contracts';

export function buildEvidenceFromEntity(entity: Entity): AreaPlanEvidence[] {
  return (
    entity.provenance?.locations
      ?.filter((location) => location.input === 'primary' && typeof location.path === 'string')
      .map((location) => ({
        path: location.path,
        reason: `Refinement evidence for ${entity.id}`,
      })) ?? []
  );
}

export function buildEdgeEvidence(relation: Relation): AreaPlanEvidence[] {
  return (
    relation.provenance?.locations
      ?.filter((location) => location.input === 'primary' && typeof location.path === 'string')
      .map((location) => ({
        path: location.path,
        reason: `Refinement edge evidence for ${relation.id}`,
      })) ?? []
  );
}

export function getEntityGroupMode(
  entity: Entity,
  semantics: SchemaSemantics,
): GroupMode | undefined {
  return isGroupLikeType(semantics, entity.type) && entity.props?.mode === 'typed'
    ? 'typed'
    : isGroupLikeType(semantics, entity.type)
      ? 'mixed'
      : undefined;
}

export function getEntityGroupTypeId(
  entity: Entity,
  semantics: SchemaSemantics,
): string | undefined {
  return isGroupLikeType(semantics, entity.type) && typeof entity.props?.groupType === 'string'
    ? entity.props.groupType
    : undefined;
}

export function createRootNodeState(entity: Entity, semantics: SchemaSemantics): RefinedChildNode {
  const evidence = buildEvidenceFromEntity(entity);
  return {
    id: entity.id,
    parentId: entity.parent,
    localId: entity.id.split('/').at(-1) ?? entity.id,
    name: entity.name,
    description: entity.description,
    typeId: entity.type,
    props: entity.props,
    scope: [...new Set(evidence.map((item) => item.path))],
    evidence,
    queueDecision: 'leaf',
    groupMode: getEntityGroupMode(entity, semantics),
    groupTypeId: getEntityGroupTypeId(entity, semantics),
  };
}

export function buildRootTask(params: {
  semantics: SchemaSemantics;
  entity: Entity;
  areaPlan: AreaPlan;
  edgeContracts: RefinableEdgeContract[];
}): NodeRefinementTask {
  const planSupport = buildPlanSupportForEntity({
    plan: params.areaPlan,
    entity: params.entity,
  });
  const evidence =
    planSupport.evidence.length > 0 ? planSupport.evidence : buildEvidenceFromEntity(params.entity);
  const scope =
    planSupport.scope.length > 0
      ? planSupport.scope
      : [...new Set(evidence.map((item) => item.path))];
  return {
    nodeId: params.entity.id,
    nodeTypeId: params.entity.type,
    nodeName: planSupport.title || params.entity.name,
    parentNodeId: params.entity.parent,
    groupMode: getEntityGroupMode(params.entity, params.semantics),
    groupTypeId: getEntityGroupTypeId(params.entity, params.semantics),
    scope: scope.length > 0 ? scope : ['.'],
    evidence:
      evidence.length > 0
        ? evidence
        : [
            {
              path: '.',
              reason: `Backbone node ${params.entity.id} has no stronger scoped evidence`,
            },
          ],
    depth: 0,
    inboundEdges: params.edgeContracts
      .filter((edge) => edge.targetId === params.entity.id)
      .map((edge) => ({ ...edge, side: 'ingress' as const })),
    outboundEdges: params.edgeContracts
      .filter((edge) => edge.sourceId === params.entity.id)
      .map((edge) => ({ ...edge, side: 'egress' as const })),
  };
}

export function buildChildTask(params: {
  child: RefinedChildNode;
  edgeContracts: RefinableEdgeContract[];
  activeEdgeProposals: ActiveEdgeProposal[];
  depth: number;
}): NodeRefinementTask {
  const edgeContractById = new Map(
    params.edgeContracts.map((edgeContract) => [edgeContract.id, edgeContract] as const),
  );
  const proposalEndpointMap = buildActiveEdgeProposalMap(params.activeEdgeProposals);
  const proposalEdges = params.activeEdgeProposals.flatMap((proposal) => {
    if (proposal.childId !== params.child.id) {
      return [];
    }
    const baseEdge = edgeContractById.get(proposal.edgeId);
    if (!baseEdge) {
      return [];
    }
    const oppositeProposalEndpoints = proposalEndpointMap.get(proposal.edgeId);
    const sourceProposal = proposal.endpoint === 'to' ? oppositeProposalEndpoints?.from : undefined;
    const targetProposal = proposal.endpoint === 'from' ? oppositeProposalEndpoints?.to : undefined;
    return [
      {
        ...baseEdge,
        relationTypeId: proposal.relationTypeId ?? baseEdge.relationTypeId,
        sourceId:
          proposal.endpoint === 'from'
            ? params.child.id
            : (sourceProposal?.childId ?? baseEdge.sourceId),
        sourceTypeId:
          proposal.endpoint === 'from'
            ? params.child.typeId
            : (sourceProposal?.childTypeId ?? baseEdge.sourceTypeId),
        targetId:
          proposal.endpoint === 'to'
            ? params.child.id
            : (targetProposal?.childId ?? baseEdge.targetId),
        targetTypeId:
          proposal.endpoint === 'to'
            ? params.child.typeId
            : (targetProposal?.childTypeId ?? baseEdge.targetTypeId),
      } satisfies RefinableEdgeContract,
    ];
  });
  // Distinct IDs can deliberately share endpoints/type; preserve them for explicit handles
  // and ambiguity diagnostics. Only collapse identical real/proposal task views.
  const taskEdgeContracts = [
    ...new Map(
      [...params.edgeContracts, ...proposalEdges].map((edge) => [
        JSON.stringify([edge.id, edge.sourceId, edge.targetId, edge.relationTypeId]),
        edge,
      ]),
    ).values(),
  ];
  return {
    nodeId: params.child.id,
    nodeTypeId: params.child.typeId,
    nodeName: params.child.name,
    parentNodeId: params.child.parentId,
    groupMode: params.child.groupMode,
    groupTypeId: params.child.groupTypeId,
    scope: params.child.scope.length > 0 ? params.child.scope : ['.'],
    evidence: params.child.evidence,
    depth: params.depth,
    inboundEdges: taskEdgeContracts
      .filter((edge) => edge.targetId === params.child.id)
      .map((edge) => ({ ...edge, side: 'ingress' as const })),
    outboundEdges: taskEdgeContracts
      .filter((edge) => edge.sourceId === params.child.id)
      .map((edge) => ({ ...edge, side: 'egress' as const })),
  };
}
