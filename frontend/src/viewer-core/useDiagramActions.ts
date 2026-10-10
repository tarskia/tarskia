import {
  applyDiagramViewOperation,
  type DiagramView,
  type DiagramViewOperation,
  type SemanticIndex,
} from '@tarskia/diagram-semantics';
import { useCallback } from 'react';
import type {
  MotionCallbacks,
  NavigationIntent,
  NavigationRequestResult,
  StructuralTransitionIntent,
} from '../diagram/motion-types';
import type { CommitView } from './types';

interface EntityZoomOptions extends MotionCallbacks {
  expandSingleChildChain?: boolean;
}
interface UseDiagramActionsArgs {
  state: { index: SemanticIndex; view: DiagramView | undefined };
  document: { commitView: CommitView };
  transition: {
    requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
    setPendingStructuralTransitionIntent: (intent: StructuralTransitionIntent | null) => void;
    flushUserGesture: () => boolean;
  };
}

export function useDiagramActions({
  state: { index, view },
  document: { commitView },
  transition,
}: UseDiagramActionsArgs) {
  const { requestNavigation, setPendingStructuralTransitionIntent, flushUserGesture } = transition;
  const tree = index.tree;
  const dispatch = useCallback(
    (operation: DiagramViewOperation, intent: StructuralTransitionIntent) => {
      if (applyDiagramViewOperation(tree, view, operation) === view) return false;
      flushUserGesture();
      setPendingStructuralTransitionIntent(intent);
      commitView((previous) => applyDiagramViewOperation(tree, previous, operation));
      return true;
    },
    [tree, view, commitView, flushUserGesture, setPendingStructuralTransitionIntent],
  );
  const centerScene = useCallback(() => {
    requestNavigation({ kind: 'fit-scene', preset: 'layout' });
  }, [requestNavigation]);
  const expandAll = useCallback(
    () => dispatch({ kind: 'expand-all' }, { direction: 'in', focus: { kind: 'global' } }),
    [dispatch],
  );
  const collapseAll = useCallback(
    () => dispatch({ kind: 'collapse-all' }, { direction: 'out', focus: { kind: 'global' } }),
    [dispatch],
  );
  const triggerEntityZoom = useCallback(
    (entityId: string, direction: 'in' | 'out', options?: EntityZoomOptions) =>
      dispatch(
        {
          kind: 'set-expansion',
          entityId,
          expanded: direction === 'in',
          expandSingleChildChain: options?.expandSingleChildChain,
        },
        {
          direction,
          focus: { kind: 'single', rootId: entityId },
          ...(options?.onComplete ? { onComplete: options.onComplete } : {}),
          ...(options?.onSettled ? { onSettled: options.onSettled } : {}),
        },
      ),
    [dispatch],
  );
  const expandAllDetailsWithin = useCallback(
    (rootId: string) =>
      dispatch(
        { kind: 'expand-within', entityId: rootId },
        { direction: 'in', focus: { kind: 'local', rootId } },
      ),
    [dispatch],
  );
  const collapseAllDetailsWithin = useCallback(
    (rootId: string) =>
      dispatch(
        { kind: 'collapse-within', entityId: rootId },
        { direction: 'out', focus: { kind: 'local', rootId } },
      ),
    [dispatch],
  );
  const expandChildGroupsWithin = useCallback(
    (rootId: string) =>
      dispatch(
        { kind: 'expand-child-groups', entityId: rootId },
        { direction: 'in', focus: { kind: 'local', rootId } },
      ),
    [dispatch],
  );
  const collapseChildGroupsWithin = useCallback(
    (rootId: string) =>
      dispatch(
        { kind: 'collapse-child-groups', entityId: rootId },
        { direction: 'out', focus: { kind: 'local', rootId } },
      ),
    [dispatch],
  );
  const toggleHighlight = useCallback(
    (entityId: string) =>
      commitView((previous) =>
        applyDiagramViewOperation(tree, previous, { kind: 'toggle-highlight', entityId }),
      ),
    [tree, commitView],
  );
  const clearHighlights = useCallback(
    () =>
      commitView((previous) =>
        applyDiagramViewOperation(tree, previous, { kind: 'clear-highlights' }),
      ),
    [tree, commitView],
  );
  return {
    toggleHighlight,
    clearHighlights,
    centerScene,
    expandAll,
    collapseAll,
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
  };
}
