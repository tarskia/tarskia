import type { Logger } from '../../logger';
import type { SchemaSemantics } from '../../semantic';
import { isGroupLikeType } from '../refinement-helpers';
import type { NodeRefinementResult, NodeRefinementState, NodeRefinementTask } from '../types';

export function canExpandRefinementChildren(
  task: NodeRefinementTask,
  state: NodeRefinementState,
): boolean {
  return task.depth + 1 < state.budgets.maxDepth;
}

export function applySoftExpansionPolicy(params: {
  semantics: SchemaSemantics;
  task: NodeRefinementTask;
  result: NodeRefinementResult;
  state: NodeRefinementState;
  logger: Logger;
}): NodeRefinementResult {
  const childDepth = params.task.depth + 1;
  const maxDepthReached = childDepth >= params.state.budgets.maxDepth;
  const children = params.result.children.map((child) => ({ ...child }));
  const canQueueAdditionalChildren = !maxDepthReached;
  let changed = false;

  if (canQueueAdditionalChildren) {
    const upgradedGroupChildIds: string[] = [];
    for (const child of children) {
      if (isGroupLikeType(params.semantics, child.typeId) && child.queueDecision === 'leaf') {
        child.queueDecision = 'expand';
        changed = true;
        upgradedGroupChildIds.push(child.localId);
      }
    }
    if (upgradedGroupChildIds.length > 0) {
      params.logger.warn(
        `Marking group child${upgradedGroupChildIds.length === 1 ? '' : 'ren'} under ${params.task.nodeId} as expandable because leaf groups would become empty wrappers: ${upgradedGroupChildIds.join(', ')}`,
      );
    }
  }

  const expandableChildren = children.filter((child) => child.queueDecision === 'expand');
  if (expandableChildren.length === 0) {
    return changed ? { ...params.result, children } : params.result;
  }

  if (maxDepthReached) {
    if (expandableChildren.length > 0) {
      const exhaustionReasons: string[] = [];
      if (maxDepthReached) {
        exhaustionReasons.push(
          `next child depth ${childDepth} reaches maxDepth=${params.state.budgets.maxDepth}`,
        );
      }
      params.logger.warn(
        `Downgrading ${expandableChildren.length} expandable child${expandableChildren.length === 1 ? '' : 'ren'} under ${params.task.nodeId} to leaf because ${exhaustionReasons.join(', ') || 'the refinement budget is exhausted'}`,
      );
    }
    for (const child of children) {
      if (child.queueDecision === 'expand') {
        child.queueDecision = 'leaf';
      }
    }
    return {
      ...params.result,
      children,
    };
  }

  return changed ? { ...params.result, children } : params.result;
}
