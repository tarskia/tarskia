import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type {
  NavigationIntent,
  NavigationRequestResult,
  StructuralChoreographyRequest,
  StructuralTransitionFocus,
  StructuralTransitionIntent,
} from '../diagram/motion-types';
import type { ViewportState } from '../model/types';
import type { CompiledDiagramEdge, DeclarativeDiagramViewState } from '../semantic';
import type { CompileResult } from './compiler/compile';
import type { LayoutResult } from './rendering/layout/layout-pipeline';
import type { CanvasRenderSnapshot } from './rendering/presentation/presentation';
import {
  type AnimationSettings,
  FOCUS_SCOPE_CAMERA_PAUSE_MS,
} from './rendering/transition/animation-constants';
import type { TransitionPlanningAdvisory } from './rendering/transition/sequencer';

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
  buildTransitionAdvisory: (params: {
    direction: 'in' | 'out';
    fromTree: LayoutResult['tree'];
    toTree: LayoutResult['tree'];
    fromEdges: CompiledDiagramEdge[];
    toEdges: CompiledDiagramEdge[];
    animationSettings: AnimationSettings;
  }) => TransitionPlanningAdvisory;
  resolveViewportFocusRoot: (tree: LayoutResult['tree'], requestedRootId: string) => string;
  viewportOps: ViewportOps;
  animationSettings: AnimationSettings;
  skipTransitions: boolean;
  getCurrentViewport: () => ViewportState;
  getCurrentDisplaySnapshot: () => CanvasRenderSnapshot;
  isMotionActive: boolean;
  requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
  startChoreography: (
    request: StructuralChoreographyRequest,
    options?: { onComplete?: () => void },
  ) => void;
  cancelMotion: () => void;
  getPendingStructuralTransitionIntent: () => StructuralTransitionIntent | null;
  clearPendingStructuralTransitionIntent: () => void;
  traceSelection: (event: string, payload?: Record<string, unknown>) => void;
}

export interface CanvasTransitionControllerResult {
  compiled: CompileResult;
  isTransitionQueued: boolean;
  cancelTransitions: () => void;
}

interface ObservedExpandedTransition {
  direction: 'in' | 'out';
  focus: StructuralTransitionFocus | null;
  changedExpandedNodeIds: string[];
  fromLayout: LayoutResult;
  toLayout: LayoutResult;
  onComplete?: () => void;
}

interface ObservedScopeTransition {
  direction: 'in' | 'out';
  fromLayout: LayoutResult;
  toLayout: LayoutResult;
  retainedNodeIds: string[];
  navigationIntent: NavigationIntent | null;
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
    previousViewState.hiddenKey === currentViewState.hiddenKey &&
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
    previousViewState.hiddenKey === currentViewState.hiddenKey &&
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
  previousLayout: LayoutResult;
  currentLayout: LayoutResult;
}): ObservedScopeTransition | null => {
  const { previousViewState, currentViewState, previousLayout, currentLayout } = params;
  if (
    !hasOnlyScopeRootChanged({
      previousViewState,
      currentViewState,
    })
  ) {
    return null;
  }
  return {
    direction: currentViewState.view.scopeRootId ? 'out' : 'in',
    fromLayout: previousLayout,
    toLayout: currentLayout,
    retainedNodeIds: Array.from(currentLayout.visibleIds).filter((nodeId) =>
      previousLayout.visibleIds.has(nodeId),
    ),
    navigationIntent: buildScopeNavigationIntent({
      previousViewState,
      currentViewState,
      previousLayout,
      currentLayout,
    }),
  };
};

export function useCanvasTransitionController({
  layout,
  stableSnapshot,
  declarativeViewState,
  buildTransitionAdvisory,
  resolveViewportFocusRoot,
  viewportOps,
  animationSettings,
  skipTransitions,
  getCurrentViewport,
  getCurrentDisplaySnapshot,
  isMotionActive,
  requestNavigation,
  startChoreography,
  cancelMotion,
  getPendingStructuralTransitionIntent,
  clearPendingStructuralTransitionIntent,
  traceSelection,
}: UseCanvasTransitionControllerArgs): CanvasTransitionControllerResult {
  const previousDeclarativeViewStateRef = useRef<DeclarativeDiagramViewState | null>(null);
  const previousLayoutRef = useRef<LayoutResult | null>(null);
  const previousStableSnapshotRef = useRef<CanvasRenderSnapshot | null>(null);

  const compiled = useMemo<CompileResult>(() => ({ scene: layout }), [layout]);
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
            changedExpandedNodeIds,
            fromLayout: previousLayoutRef.current,
            toLayout: layout,
            onComplete: pendingStructuralTransitionIntent.onComplete,
          };
        })()
      : null;
  const observedScopeTransition =
    previousDeclarativeViewStateRef.current && previousLayoutRef.current && viewChanged
      ? buildObservedScopeTransition({
          previousViewState: previousDeclarativeViewStateRef.current,
          currentViewState: declarativeViewState,
          previousLayout: previousLayoutRef.current,
          currentLayout: layout,
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
    if (skipTransitions) {
      if (scopeNavigationIntent) {
        requestNavigation(scopeNavigationIntent);
      }
      clearPendingStructuralTransitionIntent();
      syncObservedState();
      return;
    }
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

    if (observedScopeTransition) {
      traceSelection('layoutEffect:startingScopeTransition', {
        direction: observedScopeTransition.direction,
        fromNodes: observedScopeTransition.fromLayout.tree.byId.size,
        toNodes: observedScopeTransition.toLayout.tree.byId.size,
      });

      const planningAdvisory = buildTransitionAdvisory({
        direction: observedScopeTransition.direction,
        fromTree: observedScopeTransition.fromLayout.tree,
        toTree: observedScopeTransition.toLayout.tree,
        fromEdges: observedScopeTransition.fromLayout.edges,
        toEdges: observedScopeTransition.toLayout.edges,
        animationSettings,
      });

      traceSelection('layoutEffect:scopeAdvisoryBuilt', {
        direction: observedScopeTransition.direction,
        steps: planningAdvisory.sequence.steps.length,
        nodeAdvisories: planningAdvisory.sequence.nodeAdvisories.size,
        edgeAdvisories: planningAdvisory.structure.edgeDiffs.length,
      });

      const currentDisplaySnapshot = getCurrentDisplaySnapshot();
      const startSnapshot =
        isMotionActive || !previousStableSnapshotRef.current
          ? currentDisplaySnapshot
          : previousStableSnapshotRef.current;
      const exitingScope = observedScopeTransition.direction === 'in';

      startChoreography(
        {
          direction: observedScopeTransition.direction,
          focus: null,
          startLayout: observedScopeTransition.fromLayout,
          endLayout: observedScopeTransition.toLayout,
          startSnapshot,
          endSnapshot: stableSnapshot,
          currentViewport: getCurrentViewport(),
          endPointOfInterestNodeIds: [],
          pauseBeforeOverlayMs: exitingScope ? FOCUS_SCOPE_CAMERA_PAUSE_MS : undefined,
          pauseAfterOverlayMs: exitingScope ? undefined : FOCUS_SCOPE_CAMERA_PAUSE_MS,
          exitScopeRetainedNodeIds: exitingScope
            ? observedScopeTransition.retainedNodeIds
            : undefined,
          postOverlayViewportBridgeNodeIds: exitingScope
            ? undefined
            : observedScopeTransition.retainedNodeIds,
          sharedNodeGeometry: exitingScope ? undefined : 'freeze-from',
          collectSubtreeIds: viewportOps.collectSubtreeIds,
          planningAdvisory,
          persistFinalViewport: true,
        },
        {
          onComplete: () => {
            traceSelection('layoutEffect:scopeTransitionComplete', {
              direction: observedScopeTransition.direction,
            });
            if (!exitingScope && observedScopeTransition.navigationIntent) {
              requestNavigation(observedScopeTransition.navigationIntent);
            }
          },
        },
      );
      syncObservedState();
      return;
    }

    traceSelection('layoutEffect:startingTransition', {
      direction: observedTransition.direction,
      fromNodes: observedTransition.fromLayout.tree.byId.size,
      toNodes: observedTransition.toLayout.tree.byId.size,
      changedExpandedNodeIds: observedTransition.changedExpandedNodeIds,
    });

    const planningAdvisory = buildTransitionAdvisory({
      direction: observedTransition.direction,
      fromTree: observedTransition.fromLayout.tree,
      toTree: observedTransition.toLayout.tree,
      fromEdges: observedTransition.fromLayout.edges,
      toEdges: observedTransition.toLayout.edges,
      animationSettings,
    });

    const endPointOfInterestNodeIds = resolvePointOfInterestNodeIds({
      focus: observedTransition.focus,
      layout: observedTransition.toLayout,
      resolveViewportFocusRoot,
      collectSubtreeIds: viewportOps.collectSubtreeIds,
    });

    traceSelection('layoutEffect:advisoryBuilt', {
      direction: observedTransition.direction,
      steps: planningAdvisory.sequence.steps.length,
      nodeAdvisories: planningAdvisory.sequence.nodeAdvisories.size,
      edgeAdvisories: planningAdvisory.structure.edgeDiffs.length,
      endPointOfInterestCount: endPointOfInterestNodeIds.length,
    });

    const currentDisplaySnapshot = getCurrentDisplaySnapshot();
    const startSnapshot =
      isMotionActive || !previousStableSnapshotRef.current
        ? currentDisplaySnapshot
        : previousStableSnapshotRef.current;

    startChoreography(
      {
        direction: observedTransition.direction,
        focus: observedTransition.focus,
        startLayout: observedTransition.fromLayout,
        endLayout: observedTransition.toLayout,
        startSnapshot,
        endSnapshot: stableSnapshot,
        currentViewport: getCurrentViewport(),
        endPointOfInterestNodeIds,
        collectSubtreeIds: viewportOps.collectSubtreeIds,
        planningAdvisory,
        persistFinalViewport: true,
      },
      {
        onComplete: () => {
          traceSelection('layoutEffect:transitionComplete', {
            direction: observedTransition.direction,
            focusKind: observedTransition.focus?.kind,
            focusRootId:
              observedTransition.focus && observedTransition.focus.kind !== 'global'
                ? observedTransition.focus.rootId
                : undefined,
          });
          observedTransition.onComplete?.();
        },
      },
    );
    syncObservedState();
  }, [
    animationSettings,
    buildTransitionAdvisory,
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
    skipTransitions,
    stableSnapshot,
    startChoreography,
    syncObservedState,
    traceSelection,
    viewportOps.collectSubtreeIds,
  ]);

  return {
    compiled,
    isTransitionQueued,
    cancelTransitions,
  };
}
