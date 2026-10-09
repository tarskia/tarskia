import {
  applyDiagramViewOperation,
  buildEntityTree,
  type DiagramViewOperation,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { useCallback, useMemo } from 'react';
import type {
  MotionCallbacks,
  NavigationIntent,
  NavigationRequestResult,
  StructuralTransitionIntent,
} from '../diagram/motion-types';
import type { CommitDoc } from './types';

interface EntityZoomOptions extends MotionCallbacks {
  expandSingleChildChain?: boolean;
}
interface UseDiagramActionsArgs {
  state: { doc: SemanticDocument };
  document: { commitDoc: CommitDoc };
  transition: {
    requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
    setPendingStructuralTransitionIntent: (intent: StructuralTransitionIntent | null) => void;
    flushUserGesture: () => boolean;
  };
}

export function useDiagramActions({
  state: { doc },
  document: { commitDoc },
  transition,
}: UseDiagramActionsArgs) {
  const { requestNavigation, setPendingStructuralTransitionIntent, flushUserGesture } = transition;
  const tree = useMemo(() => buildEntityTree({ entities: doc.entities }), [doc.entities]);
  const dispatch = useCallback(
    (operation: DiagramViewOperation, intent: StructuralTransitionIntent) => {
      if (applyDiagramViewOperation(tree, doc.view, operation) === doc.view) return false;
      flushUserGesture();
      setPendingStructuralTransitionIntent(intent);
      commitDoc((previous) => {
        const view = applyDiagramViewOperation(tree, previous.view, operation);
        return view === previous.view ? previous : { ...previous, view };
      });
      return true;
    },
    [tree, doc.view, commitDoc, flushUserGesture, setPendingStructuralTransitionIntent],
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
  return {
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
