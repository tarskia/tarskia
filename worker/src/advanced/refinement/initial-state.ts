import {
  getAllowedChildTypeIds,
  getAllowedRelationTypeIds,
  type SchemaActivation,
  type SchemaModule,
  type SchemaSemantics,
  type SemanticDocument,
} from '../../semantic';
import { emptyTokenUsageTotals } from '../../token-usage';
import { isGroupLikeType } from '../refinement-helpers';
import type { AreaPlan, NodeRefinementState, RefinableEdgeContract } from '../types';
import { DEFAULT_NODE_REFINEMENT_MAX_DEPTH } from './schema-context';
import { buildEdgeEvidence, buildRootTask, createRootNodeState } from './task-construction';

export function buildInitialNodeRefinementState(params: {
  semantics: SchemaSemantics;
  level0Doc: SemanticDocument;
  areaPlan: AreaPlan;
  visibleResponsibilityIds: string[];
  maxDepth?: number;
}): NodeRefinementState {
  const entityTypeById = new Map<string, string>();
  const visit = (entities: SemanticDocument['entities']) => {
    for (const entity of entities) {
      entityTypeById.set(entity.id, entity.type);
      visit(entity.children ?? []);
    }
  };
  visit(params.level0Doc.entities);
  const edgeContracts: RefinableEdgeContract[] = params.level0Doc.relations.map((relation) => ({
    id: relation.id,
    relationTypeId: relation.type,
    description: relation.description,
    sourceId: relation.from,
    sourceTypeId: entityTypeById.get(relation.from),
    targetId: relation.to,
    targetTypeId: entityTypeById.get(relation.to),
    evidence: buildEdgeEvidence(relation),
  }));
  const rootNodeIds = params.level0Doc.entities.map((entity) => entity.id);
  const rootEntitiesById = Object.fromEntries(
    params.level0Doc.entities.map((entity) => [
      entity.id,
      createRootNodeState(entity, params.semantics),
    ]),
  );
  const visibleResponsibilityIdSet = new Set(params.visibleResponsibilityIds);
  const queue = params.level0Doc.entities
    .filter((entity) => visibleResponsibilityIdSet.has(entity.id))
    .map((entity) =>
      buildRootTask({
        semantics: params.semantics,
        entity,
        areaPlan: params.areaPlan,
        edgeContracts,
      }),
    );

  return {
    rootNodeIds,
    queue: [...queue],
    tasksByNodeId: Object.fromEntries(queue.map((task) => [task.nodeId, task])),
    nodesById: rootEntitiesById,
    refinementsByNodeId: {},
    edgeContracts,
    activeEdgeProposals: [],
    reviewedDepths: [],
    budgets: {
      maxDepth: params.maxDepth ?? DEFAULT_NODE_REFINEMENT_MAX_DEPTH,
      turnsUsed: 0,
      workItemsCreated: queue.length,
      tokenUsage: emptyTokenUsageTotals(),
    },
  };
}

export function buildRelationMatrix(params: {
  schema: SchemaModule;
  semantics: SchemaSemantics;
  parentTypeId: string;
  schemaActivations: SchemaActivation[];
}): Record<string, Record<string, string[]>> {
  const allowedChildTypeIds = getAllowedChildTypeIds({
    schema: params.schema,
    parentTypeId: params.parentTypeId,
    schemaActivations: params.schemaActivations,
  });
  return Object.fromEntries(
    allowedChildTypeIds.map((fromTypeId) => [
      fromTypeId,
      Object.fromEntries(
        allowedChildTypeIds.map((toTypeId) => [
          toTypeId,
          getAllowedRelationTypeIds({
            schema: params.schema,
            semantics: params.semantics,
            fromTypeId,
            toTypeId,
          }),
        ]),
      ),
    ]),
  );
}

export function findDisconnectedExpandableGroupNodes(
  state: NodeRefinementState,
  semantics: SchemaSemantics,
): string[] {
  const disconnectedNodeIds: string[] = [];

  for (const node of Object.values(state.nodesById)) {
    if (
      !isGroupLikeType(semantics, node.typeId) ||
      node.queueDecision !== 'expand' ||
      !node.parentId
    ) {
      continue;
    }

    const parentRefinement = state.refinementsByNodeId[node.parentId];
    if (!parentRefinement) {
      continue;
    }

    const isReferencedByParentFlow =
      parentRefinement.relations.some(
        (relation) => relation.sourceId === node.id || relation.targetId === node.id,
      ) ||
      parentRefinement.edgeRefinements.some(
        (edgeRefinement) =>
          edgeRefinement.sourceId === node.id || edgeRefinement.targetId === node.id,
      ) ||
      parentRefinement.edgeProposals.some(
        (edgeProposal) =>
          edgeProposal.childId === node.id || edgeProposal.childLocalId === node.localId,
      );

    if (!isReferencedByParentFlow) {
      disconnectedNodeIds.push(node.id);
    }
  }

  return disconnectedNodeIds.sort((left, right) => left.localeCompare(right));
}
