import { type Diagnostic, diagramDiagnostic } from '../../semantic';
import type { NodeRefinementResult, NodeRefinementState, NodeRefinementTask } from '../types';
import { isSameOrDescendantNodeId } from './edge-contracts';
import { buildChildTask } from './task-construction';

/** Refresh both real and proposal-backed edges without changing the queued task's scope. */
export function refreshNodeRefinementTask(
  state: NodeRefinementState,
  task: NodeRefinementTask,
): NodeRefinementTask {
  const node = state.nodesById[task.nodeId];
  if (!node) return task;
  const current = buildChildTask({
    child: node,
    edgeContracts: state.edgeContracts,
    activeEdgeProposals: state.activeEdgeProposals,
    depth: task.depth,
  });
  return { ...task, inboundEdges: current.inboundEdges, outboundEdges: current.outboundEdges };
}

export function resolveCurrentEdgeRefinements(params: {
  state: NodeRefinementState;
  task: NodeRefinementTask;
  result: NodeRefinementResult;
}): NodeRefinementResult {
  const currentTask = refreshNodeRefinementTask(params.state, params.task);
  const inherited = [...currentTask.inboundEdges, ...currentTask.outboundEdges];
  const currentIds = new Set(params.state.edgeContracts.map((edge) => edge.id));
  const parents = new Map<string, Set<string>>();
  const addParent = (child: string, parent: string) => {
    if (child === parent) return;
    const ids = parents.get(child) ?? new Set<string>();
    ids.add(parent);
    parents.set(child, ids);
  };
  for (const edge of params.state.edgeContracts) if (edge.refines) addParent(edge.id, edge.refines);
  for (const refinement of Object.values(params.state.refinementsByNodeId))
    for (const edge of refinement.edgeRefinements) addParent(edge.refinedEdgeId, edge.edgeId);
  const refines = (id: string, ancestor: string): boolean => {
    const pending = [id],
      seen = new Set<string>();
    while (pending.length) {
      const next = pending.pop()!;
      if (next === ancestor) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(...(parents.get(next) ?? []));
    }
    return false;
  };
  const diagnostics: Diagnostic[] = [];
  const edgeRefinements = params.result.edgeRefinements.flatMap((refinement) => {
    if (
      currentIds.has(refinement.edgeId) &&
      inherited.some((edge) => edge.id === refinement.edgeId)
    )
      return [refinement];
    const oldEdge = [...params.task.inboundEdges, ...params.task.outboundEdges].find(
      (edge) => edge.id === refinement.edgeId,
    );
    const matches = inherited.filter((edge) => {
      if (!refines(edge.id, refinement.edgeId)) return false;
      if (refinement.fromChildLocalId && edge.side !== 'egress') return false;
      if (refinement.toChildLocalId && edge.side !== 'ingress') return false;
      if (!oldEdge) return true;
      const other = edge.side === 'ingress' ? edge.sourceId : edge.targetId;
      const oldOther = edge.side === 'ingress' ? oldEdge.sourceId : oldEdge.targetId;
      return isSameOrDescendantNodeId(other, oldOther);
    });
    if (matches.length) return matches.map((edge) => ({ ...refinement, edgeId: edge.id }));
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'error',
        code: 'diagram.node_refinement.unmatched_edge_refinement',
        entityId: params.task.nodeId,
        relationId: refinement.edgeId,
        message: `Edge refinement ${refinement.edgeId} matches no current inherited edge of ${params.task.nodeId}. Use a current task edge handle.`,
      }),
    );
    return [refinement];
  });
  return {
    ...params.result,
    edgeRefinements,
    ...(diagnostics.length
      ? {
          edgeReferenceDiagnostics: [
            ...(params.result.edgeReferenceDiagnostics ?? []),
            ...diagnostics,
          ],
        }
      : {}),
  };
}
