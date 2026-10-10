import type {
  NodeRefinementContextNodeLabel,
  NodeRefinementContextNodeSummary,
  NodeRefinementNearbyConceptSummary,
  NodeRefinementState,
  NodeRefinementSurroundingContext,
  NodeRefinementTask,
  RefinedChildNode,
} from '../types';
import { findOverlappingContextPath } from './evidence';
import {
  MAX_SURROUNDING_CONTEXT_CHILDREN,
  MAX_SURROUNDING_CONTEXT_NEARBY_CONCEPTS,
} from './schema-context';

export function normalizeContextConceptName(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildContextNodeLabel(node: RefinedChildNode): NodeRefinementContextNodeLabel {
  return {
    id: node.id,
    name: node.name,
    typeId: node.typeId,
  };
}

export function listDirectChildrenForContext(
  state: NodeRefinementState,
  nodeId: string,
): NodeRefinementContextNodeLabel[] {
  return (state.refinementsByNodeId[nodeId]?.children ?? [])
    .slice(0, MAX_SURROUNDING_CONTEXT_CHILDREN)
    .map((child) => buildContextNodeLabel(child));
}

export function buildContextNodeSummary(
  state: NodeRefinementState,
  nodeId: string,
): NodeRefinementContextNodeSummary | undefined {
  const node = state.nodesById[nodeId];
  if (!node) {
    return undefined;
  }
  return {
    ...buildContextNodeLabel(node),
    scope: [...node.scope],
    directChildren: listDirectChildrenForContext(state, nodeId),
  };
}

export function listAncestorIds(state: NodeRefinementState, task: NodeRefinementTask): string[] {
  const ancestorIds: string[] = [];
  const seen = new Set<string>();
  let cursorId = task.parentNodeId;
  while (cursorId && !seen.has(cursorId)) {
    ancestorIds.unshift(cursorId);
    seen.add(cursorId);
    cursorId = state.nodesById[cursorId]?.parentId;
  }
  return ancestorIds;
}

export function getRootNodeIdForContext(
  state: NodeRefinementState,
  nodeId: string,
): string | undefined {
  let cursorId: string | undefined = nodeId;
  let lastId: string | undefined;
  const seen = new Set<string>();
  while (cursorId && !seen.has(cursorId)) {
    seen.add(cursorId);
    lastId = cursorId;
    cursorId = state.nodesById[cursorId]?.parentId;
  }
  return lastId;
}

export function getNodeDepthForContext(state: NodeRefinementState, nodeId: string): number {
  let depth = 0;
  let cursorId = state.nodesById[nodeId]?.parentId;
  const seen = new Set<string>();
  while (cursorId && !seen.has(cursorId)) {
    depth += 1;
    seen.add(cursorId);
    cursorId = state.nodesById[cursorId]?.parentId;
  }
  return depth;
}

export function buildNearbyConceptReasons(params: {
  task: NodeRefinementTask;
  candidate: RefinedChildNode;
}): string[] {
  const reasons: string[] = [];
  const taskName = normalizeContextConceptName(params.task.nodeName);
  const candidateName = normalizeContextConceptName(params.candidate.name);
  if (taskName && candidateName && taskName === candidateName) {
    reasons.push('matching concept name');
  }

  const taskPaths = [
    ...params.task.scope,
    ...params.task.evidence.map((evidence) => evidence.path),
  ];
  const candidatePaths = [
    ...params.candidate.scope,
    ...params.candidate.evidence.map((evidence) => evidence.path),
  ];
  const overlappingPath = findOverlappingContextPath(taskPaths, candidatePaths);
  if (overlappingPath) {
    reasons.push(`overlapping scope/evidence: ${overlappingPath}`);
  }

  return reasons;
}

export function buildNodeRefinementSurroundingContext(params: {
  state: NodeRefinementState;
  task: NodeRefinementTask;
}): NodeRefinementSurroundingContext {
  const ancestorIds = listAncestorIds(params.state, params.task);
  const ancestorChain = ancestorIds
    .map((ancestorId) => buildContextNodeSummary(params.state, ancestorId))
    .filter((summary): summary is NodeRefinementContextNodeSummary => Boolean(summary));

  const siblingNodeIds = params.task.parentNodeId
    ? (params.state.refinementsByNodeId[params.task.parentNodeId]?.children ?? [])
        .map((child) => child.id)
        .filter((childId) => childId !== params.task.nodeId)
    : params.state.rootNodeIds.filter((rootNodeId) => rootNodeId !== params.task.nodeId);
  const acceptedSiblings = siblingNodeIds
    .map((siblingId) => params.state.nodesById[siblingId])
    .filter((node): node is RefinedChildNode => Boolean(node))
    .map((node) => buildContextNodeLabel(node));

  const taskRootNodeId = getRootNodeIdForContext(params.state, params.task.nodeId);
  const excludedNodeIds = new Set<string>([params.task.nodeId, ...ancestorIds, ...siblingNodeIds]);
  if (params.task.parentNodeId) {
    excludedNodeIds.add(params.task.parentNodeId);
  }

  const nearbyAcceptedConcepts = Object.values(params.state.nodesById)
    .filter((node) => {
      if (excludedNodeIds.has(node.id)) {
        return false;
      }
      return getRootNodeIdForContext(params.state, node.id) === taskRootNodeId;
    })
    .map((node) => ({
      node,
      reasons: buildNearbyConceptReasons({
        task: params.task,
        candidate: node,
      }),
    }))
    .filter(({ reasons }) => reasons.length > 0)
    .sort((left, right) => {
      if (right.reasons.length !== left.reasons.length) {
        return right.reasons.length - left.reasons.length;
      }
      const leftDepthDelta = Math.abs(
        getNodeDepthForContext(params.state, left.node.id) - params.task.depth,
      );
      const rightDepthDelta = Math.abs(
        getNodeDepthForContext(params.state, right.node.id) - params.task.depth,
      );
      if (leftDepthDelta !== rightDepthDelta) {
        return leftDepthDelta - rightDepthDelta;
      }
      return left.node.id.localeCompare(right.node.id);
    })
    .slice(0, MAX_SURROUNDING_CONTEXT_NEARBY_CONCEPTS)
    .map(
      ({ node, reasons }) =>
        ({
          ...buildContextNodeLabel(node),
          scope: [...node.scope],
          reasons,
        }) satisfies NodeRefinementNearbyConceptSummary,
    );

  return {
    ancestorChain,
    acceptedSiblings,
    nearbyAcceptedConcepts,
  };
}
