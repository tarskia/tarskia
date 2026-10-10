import type { Entity, Relation, SchemaSemantics, SemanticDocument } from '../../semantic';
import { dedupeEdgeContracts, isGroupLikeType } from '../refinement-helpers';
import type {
  ActiveEdgeProposal,
  ChildNodeSpec,
  NodeRefinementResult,
  NodeRefinementState,
  NodeRefinementTask,
  RefinedChildNode,
} from '../types';
import {
  createInternalEdgeContracts,
  type EdgeIdentity,
  expandRefinedEdgeContracts,
} from './edge-contracts';
import { buildChildTask } from './task-construction';
import { resolveCurrentEdgeRefinements } from './task-refresh';

export function buildEntityForChildSpec(params: {
  parentNodeId: string;
  child: ChildNodeSpec;
}): RefinedChildNode {
  return {
    id: `${params.parentNodeId}/${params.child.localId}`,
    parentId: params.parentNodeId,
    localId: params.child.localId,
    name: params.child.name,
    description: params.child.description,
    typeId: params.child.typeId,
    props: params.child.props,
    scope: params.child.scope,
    evidence: params.child.evidence,
    queueDecision: params.child.queueDecision,
    groupMode: params.child.groupMode,
    groupTypeId: params.child.groupTypeId,
  };
}

export function applyNodeRefinementResult(params: {
  state: NodeRefinementState;
  task: NodeRefinementTask;
  result: NodeRefinementResult;
}): NodeRefinementState {
  params = { ...params, result: resolveCurrentEdgeRefinements(params) };
  const childEntities = params.result.children.map((child) =>
    buildEntityForChildSpec({
      parentNodeId: params.task.nodeId,
      child,
    }),
  );
  const usedIds = new Map<string, EdgeIdentity>();
  const edgeExpansion = expandRefinedEdgeContracts({
    usedIds,
    edgeContracts: params.state.edgeContracts,
    result: params.result,
    childEntities,
    activeEdgeProposals: params.state.activeEdgeProposals,
  });
  const internalEdgeContracts = createInternalEdgeContracts({
    usedIds,
    result: params.result,
    childEntities,
  });
  const mergedEdgeContracts = dedupeEdgeContracts([
    ...edgeExpansion.edgeContracts,
    ...internalEdgeContracts,
  ]);
  const nextActiveEdgeProposals = params.state.activeEdgeProposals.filter((proposal) => {
    if (
      edgeExpansion.consumedEdgeProposals.some(
        (consumed) =>
          consumed.edgeId === proposal.edgeId && consumed.endpoint === proposal.endpoint,
      )
    ) {
      return false;
    }
    if (
      [...params.task.inboundEdges, ...params.task.outboundEdges].some(
        (edge) => edge.id === proposal.edgeId,
      ) &&
      proposal.childId === params.task.nodeId
    ) {
      return false;
    }
    return true;
  });
  const appliedEdgeProposals = (params.result.edgeProposals ?? [])
    .map((edgeProposal): ActiveEdgeProposal | undefined => {
      const child = childEntities.find((entity) => entity.localId === edgeProposal.childLocalId);
      if (!child) {
        return undefined;
      }
      return {
        edgeId: edgeProposal.edgeId,
        endpoint: edgeProposal.endpoint,
        relationTypeId: edgeProposal.relationTypeId,
        childId: child.id,
        childLocalId: child.localId,
        childTypeId: child.typeId,
        ownerNodeId: params.task.nodeId,
      } satisfies ActiveEdgeProposal;
    })
    .filter((proposal): proposal is ActiveEdgeProposal => proposal !== undefined);
  const mergedActiveEdgeProposals = [...nextActiveEdgeProposals];
  for (const proposal of appliedEdgeProposals) {
    const existingIndex = mergedActiveEdgeProposals.findIndex(
      (candidate) =>
        candidate.edgeId === proposal.edgeId && candidate.endpoint === proposal.endpoint,
    );
    if (existingIndex >= 0) {
      mergedActiveEdgeProposals.splice(existingIndex, 1, proposal);
    } else {
      mergedActiveEdgeProposals.push(proposal);
    }
  }
  const queuedChildren = childEntities.filter((child) => child.queueDecision === 'expand');
  const childTasks = queuedChildren.map((child) =>
    buildChildTask({
      child,
      edgeContracts: mergedEdgeContracts,
      activeEdgeProposals: mergedActiveEdgeProposals,
      depth: params.task.depth + 1,
    }),
  );

  return {
    ...params.state,
    queue: [...params.state.queue, ...childTasks],
    tasksByNodeId: {
      ...params.state.tasksByNodeId,
      ...Object.fromEntries(childTasks.map((task) => [task.nodeId, task])),
    },
    nodesById: {
      ...params.state.nodesById,
      ...Object.fromEntries(childEntities.map((child) => [child.id, child])),
    },
    refinementsByNodeId: {
      ...params.state.refinementsByNodeId,
      [params.task.nodeId]: {
        nodeId: params.task.nodeId,
        description: params.result.description,
        children: childEntities,
        relations: internalEdgeContracts,
        edgeRefinements: edgeExpansion.appliedEdgeRefinements,
        edgeProposals: appliedEdgeProposals.map((proposal) => ({
          edgeId: proposal.edgeId,
          endpoint: proposal.endpoint,
          relationTypeId: proposal.relationTypeId,
          childId: proposal.childId,
          childLocalId: proposal.childLocalId,
          childTypeId: proposal.childTypeId,
        })),
        openQuestions: params.result.openQuestions ?? [],
      },
    },
    edgeContracts: mergedEdgeContracts,
    activeEdgeProposals: mergedActiveEdgeProposals,
    budgets: {
      ...params.state.budgets,
      workItemsCreated: params.state.budgets.workItemsCreated + childTasks.length,
    },
  };
}

export function buildEntityFromNodeState(params: {
  nodeId: string;
  state: NodeRefinementState;
  semantics: SchemaSemantics;
}): Entity {
  const node = params.state.nodesById[params.nodeId];
  if (!node) {
    throw new Error(`Missing node state for ${params.nodeId}`);
  }
  const refinement = params.state.refinementsByNodeId[params.nodeId];
  const props = isGroupLikeType(params.semantics, node.typeId)
    ? {
        ...(node.props ?? {}),
        mode: node.groupMode ?? 'mixed',
        ...(node.groupMode === 'typed' && node.groupTypeId ? { groupType: node.groupTypeId } : {}),
      }
    : node.props;
  const children = refinement?.children.map((child) =>
    buildEntityFromNodeState({
      semantics: params.semantics,
      nodeId: child.id,
      state: params.state,
    }),
  );
  return {
    id: node.id,
    type: node.typeId,
    name: node.name,
    description: refinement?.description ?? node.description,
    props,
    provenance:
      node.evidence.length > 0
        ? {
            locations: node.evidence.map((evidence) => ({
              input: 'primary',
              path: evidence.path,
            })),
          }
        : undefined,
    children: children && children.length > 0 ? children : undefined,
    parent: node.parentId,
  };
}

export function assembleRefinedDocument(params: {
  semantics: SchemaSemantics;
  baseDoc: SemanticDocument;
  state: NodeRefinementState;
}): SemanticDocument {
  const entities = params.state.rootNodeIds
    .map((nodeId) =>
      buildEntityFromNodeState({
        semantics: params.semantics,
        nodeId,
        state: params.state,
      }),
    )
    .filter((entity): entity is Entity => Boolean(entity));
  const relations: Relation[] = params.state.edgeContracts.map((edge) => ({
    id: edge.id,
    type: edge.relationTypeId,
    description: edge.description,
    from: edge.sourceId,
    to: edge.targetId,
    provenance:
      edge.evidence.length > 0
        ? {
            locations: edge.evidence.map((evidence) => ({
              input: 'primary',
              path: evidence.path,
            })),
          }
        : undefined,
  }));

  return {
    version: params.baseDoc.version,
    schemaRefs: params.baseDoc.schemaRefs,
    entities,
    relations,
  };
}
