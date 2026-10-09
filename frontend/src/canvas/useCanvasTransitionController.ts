import type { ViewportState } from '@tarskia/diagram-semantics';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type {
  MotionCallbacks,
  NavigationIntent,
  NavigationRequestResult,
  StructuralChoreographyRequest,
  StructuralTransitionFocus,
  StructuralTransitionIntent,
} from '../diagram/motion-types';
import type { DeclarativeDiagramViewState } from '../semantic/view/declarative-view-state';
import type { LayoutResult } from './rendering/layout/layout-pipeline';
import type { CanvasRenderSnapshot } from './rendering/presentation/presentation';

export type TransitionFocus = StructuralTransitionFocus;

interface ViewportOps {
  collectSubtreeIds: (tree: LayoutResult['tree'], rootId: string) => Set<string>;
}

const resolvePointOfInterestNodeIds = (params: {
  focus: TransitionFocus | null;
  layout: LayoutResult;
  resolveViewportFocusRoot: (tree: LayoutResult['tree'], requestedRootId: string) => string;
  collectSubtreeIds: (tree: LayoutResult['tree'], rootId: string) => Set<string>;
}) => {
  const { focus, layout, resolveViewportFocusRoot, collectSubtreeIds } = params;
  if (!focus) {
    return [];
  }
  if (focus.kind === 'global') {
    return Array.from(layout.visibleIds);
  }
  const focusRootId = resolveViewportFocusRoot(layout.tree, focus.rootId);
  if (!layout.tree.byId.has(focusRootId)) {
    return [];
  }
  return Array.from(collectSubtreeIds(layout.tree, focusRootId));
};

export interface UseCanvasTransitionControllerArgs {
  layout: LayoutResult;
  stableSnapshot: CanvasRenderSnapshot;
  declarativeViewState: DeclarativeDiagramViewState;
  resolveViewportFocusRoot: (tree: LayoutResult['tree'], requestedRootId: string) => string;
  viewportOps: ViewportOps;
  skipTransitions: boolean;
  getCurrentViewport: () => ViewportState;
  getCurrentDisplaySnapshot: () => CanvasRenderSnapshot;
  isMotionActive: boolean;
  requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
  startChoreography: (request: StructuralChoreographyRequest, options?: MotionCallbacks) => void;
  cancelMotion: () => void;
  getPendingStructuralTransitionIntent: () => StructuralTransitionIntent | null;
  clearPendingStructuralTransitionIntent: () => void;
}

export interface CanvasTransitionControllerResult {
  compiled: LayoutResult;
  isTransitionQueued: boolean;
  cancelTransitions: () => void;
}

interface ObservedExpandedTransition {
  direction: 'in' | 'out';
  focus: StructuralTransitionFocus | null;
  onComplete?: MotionCallbacks['onComplete'];
  onSettled?: MotionCallbacks['onSettled'];
}

export const collectChangedExpandedNodeIds = (params: {
  previousExpanded: Record<string, boolean>;
  currentExpanded: Record<string, boolean>;
  previousLayout: LayoutResult;
  currentLayout: LayoutResult;
}): string[] => {
  const { previousExpanded, currentExpanded, previousLayout, currentLayout } = params;
  const nodeIds = new Set([...Object.keys(previousExpanded), ...Object.keys(currentExpanded)]);
  return [...nodeIds]
    .filter((nodeId) => Boolean(previousExpanded[nodeId]) !== Boolean(currentExpanded[nodeId]))
    .filter((nodeId) => previousLayout.tree.byId.has(nodeId) || currentLayout.tree.byId.has(nodeId))
    .sort((leftId, rightId) => leftId.localeCompare(rightId));
};

export const resolveExpandedDiffDirection = (params: {
  changedExpandedNodeIds: string[];
  previousExpanded: Record<string, boolean>;
  currentExpanded: Record<string, boolean>;
}): 'in' | 'out' | null => {
  const { changedExpandedNodeIds, previousExpanded, currentExpanded } = params;
  if (changedExpandedNodeIds.length === 0) {
    return null;
  }
  if (
    changedExpandedNodeIds.every((nodeId) => !previousExpanded[nodeId] && currentExpanded[nodeId])
  ) {
    return 'in';
  }
  if (
    changedExpandedNodeIds.every((nodeId) => previousExpanded[nodeId] && !currentExpanded[nodeId])
  ) {
    return 'out';
  }
  return null;
};

export const hasOnlyExpandedMapChanged = (params: {
  previousViewState: DeclarativeDiagramViewState;
  currentViewState: DeclarativeDiagramViewState;
}) => {
  const { previousViewState, currentViewState } = params;
  return (
    previousViewState.view.scopeRootId === currentViewState.view.scopeRootId &&
    previousViewState.highlightedKey === currentViewState.highlightedKey &&
    previousViewState.layoutKey === currentViewState.layoutKey
  );
};

export const shouldObservePendingStructuralTransition = (params: {
  previousViewState: DeclarativeDiagramViewState;
  currentViewState: DeclarativeDiagramViewState;
  pendingStructuralTransitionIntent: StructuralTransitionIntent;
}) =>
  hasOnlyExpandedMapChanged(params) ||
  Boolean(params.pendingStructuralTransitionIntent.allowNonExpansionViewChanges);

export const hasOnlyScopeRootChanged = (params: {
  previousViewState: DeclarativeDiagramViewState;
  currentViewState: DeclarativeDiagramViewState;
}) => {
  const { previousViewState, currentViewState } = params;
  return (
    previousViewState.view.scopeRootId !== currentViewState.view.scopeRootId &&
    previousViewState.expandedKey === currentViewState.expandedKey &&
    previousViewState.highlightedKey === currentViewState.highlightedKey &&
    previousViewState.layoutKey === currentViewState.layoutKey
  );
};

export const buildScopeNavigationIntent = (params: {
  previousViewState: DeclarativeDiagramViewState;
  currentViewState: DeclarativeDiagramViewState;
  previousLayout?: LayoutResult;
  currentLayout: LayoutResult;
}): NavigationIntent | null => {
  const { previousViewState, currentViewState, currentLayout } = params;
  const previousScopeRootId = previousViewState.view.scopeRootId;
  const currentScopeRootId = currentViewState.view.scopeRootId;
  if (previousScopeRootId === currentScopeRootId) {
    return null;
  }
  if (currentScopeRootId) {
    const nodeIds = Array.from(currentLayout.visibleIds);
    if (nodeIds.length === 0) {
      return null;
    }
    return {
      kind: 'fit-node-set',
      nodeIds,
      preset: 'focus',
      deferUntilNextFrame: true,
    };
  }
  if (
    !hasOnlyScopeRootChanged({
      previousViewState,
      currentViewState,
    })
  ) {
    return null;
  }
  return {
    kind: 'fit-scene',
    preset: 'layout',
    deferUntilNextFrame: true,
  };
};

export const buildObservedScopeTransition = (params: {
  previousViewState: DeclarativeDiagramViewState;
  currentViewState: DeclarativeDiagramViewState;
}) =>
  hasOnlyScopeRootChanged(params)
    ? { direction: params.currentViewState.view.scopeRootId ? ('out' as const) : ('in' as const) }
    : null;

export function useCanvasTransitionController({
  layout,
  stableSnapshot,
  declarativeViewState,
  resolveViewportFocusRoot,
  viewportOps,
  skipTransitions,
  getCurrentViewport,
  getCurrentDisplaySnapshot,
  isMotionActive,
  requestNavigation,
  startChoreography,
  cancelMotion,
  getPendingStructuralTransitionIntent,
  clearPendingStructuralTransitionIntent,
}: UseCanvasTransitionControllerArgs): CanvasTransitionControllerResult {
  const previousDeclarativeViewStateRef = useRef<DeclarativeDiagramViewState | null>(null);
  const previousLayoutRef = useRef<LayoutResult | null>(null);
  const previousStableSnapshotRef = useRef<CanvasRenderSnapshot | null>(null);

  const compiled = layout;
  const pendingStructuralTransitionIntent = getPendingStructuralTransitionIntent();
  const viewChanged =
    previousDeclarativeViewStateRef.current?.key !== undefined &&
    previousDeclarativeViewStateRef.current.key !== declarativeViewState.key;
  const observedTransition: ObservedExpandedTransition | null =
    previousDeclarativeViewStateRef.current &&
    previousLayoutRef.current &&
    viewChanged &&
    pendingStructuralTransitionIntent &&
    shouldObservePendingStructuralTransition({
      previousViewState: previousDeclarativeViewStateRef.current,
      currentViewState: declarativeViewState,
      pendingStructuralTransitionIntent,
    })
      ? (() => {
          const changedExpandedNodeIds = collectChangedExpandedNodeIds({
            previousExpanded: previousDeclarativeViewStateRef.current.expanded,
            currentExpanded: declarativeViewState.expanded,
            previousLayout: previousLayoutRef.current,
            currentLayout: layout,
          });
          const direction = resolveExpandedDiffDirection({
            changedExpandedNodeIds,
            previousExpanded: previousDeclarativeViewStateRef.current.expanded,
            currentExpanded: declarativeViewState.expanded,
          });
          if (!direction || direction !== pendingStructuralTransitionIntent.direction) {
            return null;
          }
          return {
            direction,
            focus: pendingStructuralTransitionIntent.focus,
            onComplete: pendingStructuralTransitionIntent.onComplete,
            onSettled: pendingStructuralTransitionIntent.onSettled,
          };
        })()
      : null;
  const observedScopeTransition =
    previousDeclarativeViewStateRef.current && previousLayoutRef.current && viewChanged
      ? buildObservedScopeTransition({
          previousViewState: previousDeclarativeViewStateRef.current,
          currentViewState: declarativeViewState,
        })
      : null;
  const isTransitionQueued =
    !skipTransitions && Boolean(observedTransition || observedScopeTransition);

  const syncObservedState = useCallback(() => {
    previousDeclarativeViewStateRef.current = declarativeViewState;
    previousLayoutRef.current = layout;
    previousStableSnapshotRef.current = stableSnapshot;
  }, [declarativeViewState, layout, stableSnapshot]);

  const cancelTransitions = useCallback(() => {
    cancelMotion();
    clearPendingStructuralTransitionIntent();
    syncObservedState();
  }, [cancelMotion, clearPendingStructuralTransitionIntent, syncObservedState]);

  useEffect(() => {
    if (skipTransitions) {
      cancelTransitions();
    }
  }, [cancelTransitions, skipTransitions]);

  useLayoutEffect(() => {
    if (previousDeclarativeViewStateRef.current === null || previousLayoutRef.current === null) {
      syncObservedState();
      return;
    }
    const scopeNavigationIntent = buildScopeNavigationIntent({
      previousViewState: previousDeclarativeViewStateRef.current,
      currentViewState: declarativeViewState,
      currentLayout: layout,
    });
    if (previousDeclarativeViewStateRef.current.key !== declarativeViewState.key) {
      clearPendingStructuralTransitionIntent();
    }
    if (!observedTransition && !observedScopeTransition) {
      if (scopeNavigationIntent) {
        requestNavigation(scopeNavigationIntent);
      }
      syncObservedState();
      return;
    }

    const transition = observedScopeTransition ?? observedTransition;
    const focus = observedScopeTransition ? null : observedTransition?.focus;
    const endPointOfInterestNodeIds = resolvePointOfInterestNodeIds({
      focus,
      layout,
      resolveViewportFocusRoot,
      collectSubtreeIds: viewportOps.collectSubtreeIds,
    });
    const currentDisplaySnapshot = getCurrentDisplaySnapshot();
    const startSnapshot =
      isMotionActive || !previousStableSnapshotRef.current
        ? currentDisplaySnapshot
        : previousStableSnapshotRef.current;

    startChoreography(
      {
        direction: transition?.direction,
        focus,
        endLayout: layout,
        startSnapshot,
        endSnapshot: stableSnapshot,
        currentViewport: getCurrentViewport(),
        endPointOfInterestNodeIds,
      },
      {
        onComplete: observedTransition?.onComplete,
        onSettled: observedTransition?.onSettled,
      },
    );
    syncObservedState();
  }, [
    clearPendingStructuralTransitionIntent,
    declarativeViewState,
    getCurrentDisplaySnapshot,
    getCurrentViewport,
    isMotionActive,
    layout,
    observedScopeTransition,
    observedTransition,
    requestNavigation,
    resolveViewportFocusRoot,
    stableSnapshot,
    startChoreography,
    syncObservedState,

    viewportOps.collectSubtreeIds,
  ]);

  return {
    compiled,
    isTransitionQueued,
    cancelTransitions,
  };
}
