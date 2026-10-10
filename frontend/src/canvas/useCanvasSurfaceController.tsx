import type { Entity, SchemaModule, SemanticIndex } from '@tarskia/diagram-semantics';
import { type MutableRefObject, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { GetCurrentCanvasSize } from '../diagram/canvas-size';
import type {
  MotionPhase,
  NavigationIntent,
  NavigationRequestResult,
} from '../diagram/motion-types';
import type { NodeVisualMode } from '../node-visual-mode';
import type { CanvasSemanticBindings } from '../viewer-core/view-models';
import type { CanvasCamera } from './camera';
import type {
  CanvasInteractionBindings,
  CanvasMoveHandler,
  CanvasNode,
  EdgeOverlayInteractionBindings,
} from './canvas-types';
import type { DiagramCanvasProps } from './DiagramCanvas';
import { collapseFocusShellDescriptors } from './focus-shells';
import { buildCanvasRenderState } from './node-presentation';
import type { LayoutResult } from './rendering/layout/layout-pipeline';
import type { CanvasPresentation } from './rendering/presentation/presentation';
import type { TransitionFrameState } from './rendering/transition/overlay';
import type { OverlayFrameStore } from './rendering/transition/overlay-frame-store';

export interface UseCanvasSurfaceControllerArgs {
  surface: {
    canvasRef: MutableRefObject<HTMLDivElement | null>;
    onCanvasElementChange: (element: HTMLDivElement | null) => void;
    onCanvasInit: (instance: CanvasCamera) => void;
    onCanvasUnmount: () => void;
    showDebug: boolean;
    getCurrentCanvasSize: GetCurrentCanvasSize;
    canvasLayoutVersion: number;
    minZoom: number;
    maxZoom: number;
    nodeVisualMode: NodeVisualMode;
    nodeTypes: DiagramCanvasProps['nodeTypes'];
  };
  graphState: {
    schema: SchemaModule;
    graph: SemanticIndex;
    entityIndex: {
      byId: Map<string, Entity>;
      parentById: Map<string, string | undefined>;
    };
    selectedEntityId?: string;
    selectedEdgeId?: string;
    focusRootId?: string;
    searchMatches?: {
      matchingEntityIds: Set<string>;
      matchingRelationIds: Set<string>;
    };
  };
  semantic: CanvasSemanticBindings;
  graphActions: {
    setSelectedEntity: (id: string | undefined) => void;
    setSelectedEdge: (id: string | undefined) => void;
    triggerEntityZoom: (entityId: string, direction: 'in' | 'out') => boolean;
    expandAllDetailsWithin: (rootId: string) => void;
    collapseAllDetailsWithin: (rootId: string) => void;
    expandChildGroupsWithin: (rootId: string) => void;
    collapseChildGroupsWithin: (rootId: string) => void;
  };
  transition: {
    getCurrentViewport: () => { x: number; y: number; zoom: number };
    requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
    reportUserGestureStart: () => void;
    reportUserGestureMove: (viewport: { x: number; y: number; zoom: number }) => void;
    reportUserGestureEnd: (viewport: { x: number; y: number; zoom: number }) => void;
    presentation: CanvasPresentation;
    compiled: LayoutResult;
    transitionFrame: TransitionFrameState | null;
    overlayFrameStore: OverlayFrameStore | null;
    isTransitionRunning: boolean;
    isTransitionQueued: boolean;
    motionPhase: MotionPhase;
  };
}

const FOCUS_SHELL_OUTER_INSET_X = 18;
const FOCUS_SHELL_OUTER_INSET_Y = 18;
const FOCUS_SHELL_STEP_X = 16;
const FOCUS_SHELL_STEP_Y = 32;
export const buildAutoVisibleSelectionKey = (params: {
  selectedEntityId?: string;
  canvasLayoutVersion?: number;
}) => {
  const { selectedEntityId, canvasLayoutVersion = 0 } = params;
  if (!selectedEntityId) {
    return null;
  }
  // Keep selection auto-reveal tied to user selection and viewport geometry,
  // not layout-driven node movement during unrelated expand/collapse transitions.
  return [selectedEntityId, `layout:${canvasLayoutVersion}`].join(':');
};

export const shouldCommitAutoVisibleSelectionKey = (result: NavigationRequestResult) =>
  result.status === 'queued' || result.status === 'applied';

const getClientPoint = (event: unknown): { x: number; y: number } | null => {
  if (!event || typeof event !== 'object') return null;
  const candidate = event as {
    clientX?: number;
    clientY?: number;
    changedTouches?: Array<{ clientX: number; clientY: number }>;
    touches?: Array<{ clientX: number; clientY: number }>;
    nativeEvent?: unknown;
  };
  if (Array.isArray(candidate.changedTouches) || Array.isArray(candidate.touches)) {
    const touch = candidate.changedTouches?.[0] ?? candidate.touches?.[0];
    if (touch) {
      return { x: touch.clientX, y: touch.clientY };
    }
  }
  if (typeof candidate.clientX === 'number' && typeof candidate.clientY === 'number') {
    return { x: candidate.clientX, y: candidate.clientY };
  }
  if (candidate.nativeEvent) {
    return getClientPoint(candidate.nativeEvent);
  }
  return null;
};

export const shouldHandleViewportGestureEvent = (event: unknown): boolean => {
  if (!event || typeof event !== 'object') {
    return false;
  }
  const candidate = event as {
    sourceEvent?: unknown;
    nativeEvent?: unknown;
  };
  if (candidate.sourceEvent) {
    return shouldHandleViewportGestureEvent(candidate.sourceEvent);
  }
  if (candidate.nativeEvent) {
    return shouldHandleViewportGestureEvent(candidate.nativeEvent);
  }
  return Boolean(getClientPoint(event));
};

export function useCanvasSurfaceController({
  surface,
  graphState,
  semantic,
  graphActions,
  transition,
}: UseCanvasSurfaceControllerArgs) {
  const {
    canvasRef,
    onCanvasElementChange,
    onCanvasInit,
    onCanvasUnmount,
    showDebug,
    getCurrentCanvasSize,
    canvasLayoutVersion,
    minZoom,
    maxZoom,
    nodeVisualMode,
    nodeTypes,
  } = surface;
  const {
    schema,
    graph,
    entityIndex,
    selectedEntityId,
    selectedEdgeId,
    focusRootId,
    searchMatches,
  } = graphState;
  const {
    setSelectedEntity,
    setSelectedEdge,
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
  } = graphActions;
  const {
    getCurrentViewport,
    requestNavigation,
    reportUserGestureStart,
    reportUserGestureMove,
    reportUserGestureEnd,
    presentation,
    compiled,
    transitionFrame,
    overlayFrameStore,
    isTransitionRunning,
    isTransitionQueued,
    motionPhase,
  } = transition;
  const suppressPaneClickRef = useRef(false);
  const autoVisibleSelectionKeyRef = useRef<string | null>(null);
  const viewportGestureActiveRef = useRef(false);
  const suppressPaneClickOnce = useCallback(() => {
    // Ignore the immediate pane click after node/edge/popup interactions.
    suppressPaneClickRef.current = true;
    globalThis.setTimeout(() => {
      suppressPaneClickRef.current = false;
    }, 0);
  }, []);

  const decoratedPresentation = useMemo(() => {
    const matchingEntityIds = searchMatches?.matchingEntityIds;
    const matchingRelationIds = searchMatches?.matchingRelationIds;
    if (
      (!matchingEntityIds || matchingEntityIds.size === 0) &&
      (!matchingRelationIds || matchingRelationIds.size === 0)
    ) {
      return presentation;
    }
    return {
      ...presentation,
      nodes: presentation.nodes.map((node) => ({
        ...node,
        matched: matchingEntityIds?.has(node.id) ?? false,
      })),
      overlayEdges: presentation.overlayEdges.map((edge) => ({
        ...edge,
        matched: (edge.relationIds ?? [edge.relationId]).some((relationId) =>
          matchingRelationIds?.has(relationId),
        ),
      })),
    };
  }, [presentation, searchMatches?.matchingEntityIds, searchMatches?.matchingRelationIds]);
  const focusShellViews = useMemo(
    () =>
      decoratedPresentation.nodes
        .filter((node) => node.content.focusShell)
        .sort(
          (left, right) =>
            (left.content.focusShellDepth ?? 0) - (right.content.focusShellDepth ?? 0),
        ),
    [decoratedPresentation.nodes],
  );
  const focusShellHue = useMemo(() => {
    if (!focusRootId) {
      return undefined;
    }
    const focusRootEntity = entityIndex.byId.get(focusRootId);
    if (!focusRootEntity) {
      return undefined;
    }
    return (
      semantic.getEntityFocusHue(focusRootEntity.id) ?? focusShellViews[0]?.content.primaryTagHue
    );
  }, [entityIndex.byId, focusRootId, focusShellViews, semantic]);
  const focusShellFrames = useMemo(() => {
    if (!focusRootId || presentation.nodes.some((node) => node.content.focusBoundary)) {
      return [];
    }
    const focusRootEntity = entityIndex.byId.get(focusRootId);
    if (!focusRootEntity) {
      return [];
    }
    const shells = collapseFocusShellDescriptors([
      {
        id: focusRootEntity.id,
        depth: 0,
        displayName: semantic.getEntityDisplayName(focusRootEntity.id),
        typeLabel: semantic.getEntityTypeLabel(focusRootEntity.id),
        hue: focusShellHue,
        isRoot: true,
      },
      ...focusShellViews.map((shell, index) => ({
        id: shell.id,
        depth: (shell.content.focusShellDepth ?? index) + 1,
        displayName: shell.content.label.trim() || shell.content.entityType,
        typeLabel: shell.content.entityType,
        hue: focusShellHue,
        isRoot: false,
      })),
    ]);
    return shells.map((shell, index) => ({
      ...shell,
      frame: {
        left: FOCUS_SHELL_OUTER_INSET_X + index * FOCUS_SHELL_STEP_X,
        top: FOCUS_SHELL_OUTER_INSET_Y + index * FOCUS_SHELL_STEP_Y,
        right: FOCUS_SHELL_OUTER_INSET_X + index * FOCUS_SHELL_STEP_X,
        bottom: FOCUS_SHELL_OUTER_INSET_Y + index * FOCUS_SHELL_STEP_Y,
      },
    }));
  }, [entityIndex.byId, focusRootId, focusShellHue, focusShellViews, semantic, presentation.nodes]);
  const handleEdgeSelect = useCallback(
    (edgeId: string) => {
      setSelectedEntity(undefined);
      setSelectedEdge(edgeId);
      suppressPaneClickOnce();
    },
    [setSelectedEdge, setSelectedEntity, suppressPaneClickOnce],
  );

  const handleEdgeLabelClick = useCallback(
    (edgeId: string) => {
      setSelectedEdge(edgeId);
      setSelectedEntity(undefined);
      suppressPaneClickOnce();
    },
    [setSelectedEdge, setSelectedEntity, suppressPaneClickOnce],
  );

  const onMove: CanvasMoveHandler = useCallback(
    (event, viewport) => {
      if (!viewportGestureActiveRef.current && !shouldHandleViewportGestureEvent(event)) {
        return;
      }
      if (!viewportGestureActiveRef.current) {
        reportUserGestureStart();
      }
      viewportGestureActiveRef.current = true;
      reportUserGestureMove({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    },
    [reportUserGestureMove, reportUserGestureStart],
  );

  const onMoveEnd: CanvasMoveHandler = useCallback(
    (event, viewport) => {
      if (!viewportGestureActiveRef.current && !shouldHandleViewportGestureEvent(event)) {
        return;
      }
      viewportGestureActiveRef.current = false;
      reportUserGestureEnd({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    },
    [reportUserGestureEnd],
  );

  const handleSelectFocusShell = useCallback(
    (entityId: string) => {
      setSelectedEdge(undefined);
      setSelectedEntity(entityId);
    },
    [setSelectedEdge, setSelectedEntity],
  );

  const interactionBindings = useMemo<CanvasInteractionBindings>(
    () => ({
      onZoomTrigger: triggerEntityZoom,
      onExpandDetails: expandAllDetailsWithin,
      onCollapseDetails: collapseAllDetailsWithin,
      onExpandChildGroups: expandChildGroupsWithin,
      onCollapseChildGroups: collapseChildGroupsWithin,
      onEdgeLabelClick: handleEdgeLabelClick,
      onSelectNode: setSelectedEntity,
      onSelectEdge: setSelectedEdge,
    }),
    [
      triggerEntityZoom,
      expandAllDetailsWithin,
      collapseAllDetailsWithin,
      expandChildGroupsWithin,
      collapseChildGroupsWithin,
      handleEdgeLabelClick,
      setSelectedEntity,
      setSelectedEdge,
    ],
  );

  const hostRenderState = useMemo(
    () =>
      buildCanvasRenderState({
        presentation: decoratedPresentation,
        bindings: interactionBindings,
        selectedEntityId,
        selectedEdgeId,
      }),
    [decoratedPresentation, interactionBindings, selectedEntityId, selectedEdgeId],
  );
  const { nodes, overlayEdges } = hostRenderState;
  const edgeGeometrySnapshot = presentation;
  const selectedNodeView = useMemo(
    () => decoratedPresentation.nodes.find((node) => node.id === selectedEntityId),
    [decoratedPresentation.nodes, selectedEntityId],
  );

  useLayoutEffect(() => {
    if (!selectedEntityId) {
      autoVisibleSelectionKeyRef.current = null;
      return;
    }
    const nextAutoVisibleSelectionKey = buildAutoVisibleSelectionKey({
      selectedEntityId,
      canvasLayoutVersion,
    });
    if (!nextAutoVisibleSelectionKey) {
      return;
    }
    if (autoVisibleSelectionKeyRef.current === nextAutoVisibleSelectionKey) {
      return;
    }
    if (!selectedNodeView?.rect) {
      return;
    }
    if (motionPhase !== 'idle' || isTransitionQueued) {
      return;
    }
    const result = requestNavigation({
      kind: 'ensure-visible',
      preset: 'selection',
      rect: selectedNodeView.rect,
    });
    if (shouldCommitAutoVisibleSelectionKey(result)) {
      autoVisibleSelectionKeyRef.current = nextAutoVisibleSelectionKey;
    }
  }, [
    canvasLayoutVersion,
    isTransitionQueued,

    motionPhase,
    requestNavigation,
    selectedEntityId,
    selectedNodeView,
  ]);

  const onNodeClick = useCallback(
    (_event: unknown, node: CanvasNode) => {
      setSelectedEntity(node.id);
      setSelectedEdge(undefined);
      suppressPaneClickOnce();
    },
    [setSelectedEdge, setSelectedEntity, suppressPaneClickOnce],
  );

  const onCanvasPaneClick = useCallback(
    (force = false) => {
      if (!force && suppressPaneClickRef.current) {
        return;
      }
      setSelectedEntity(undefined);
      setSelectedEdge(undefined);
    },
    [setSelectedEdge, setSelectedEntity],
  );

  const overlayInteractionBindings = useMemo<EdgeOverlayInteractionBindings>(
    () => ({ onSelectEdge: handleEdgeSelect, onEdgeLabelClick: handleEdgeLabelClick }),
    [handleEdgeSelect, handleEdgeLabelClick],
  );

  const canvasProps: DiagramCanvasProps = {
    canvasRef,
    onCanvasElementChange,
    nodeVisualMode,
    nodes: nodes as CanvasNode[],
    interactionBindings,
    selectedEntityId,
    selectedEdgeId,
    edgeGeometrySnapshot,
    overlayEdges,
    overlayInteractionBindings,
    transitionFrame: transitionFrame ?? undefined,
    overlayFrameStore: overlayFrameStore ?? undefined,
    nodeTypes,
    onNodeClick,
    onInit: onCanvasInit,
    onUnmount: onCanvasUnmount,
    onPaneClick: onCanvasPaneClick,
    onMove,
    onMoveEnd,
    minZoom,
    maxZoom,
    showDebug,
    debugInputs: showDebug
      ? {
          graph,
          compiled,
          hostRenderState,
          decoratedPresentation,
          presentation,
          canvasLayoutVersion,
          getCurrentCanvasSize,
          getCurrentViewport,
          isTransitionQueued,
          isTransitionRunning,
          selectedEdgeId,
        }
      : undefined,
    onSelectFocusShell: handleSelectFocusShell,
    focusShells: focusShellFrames,
  };

  return {
    canvasProps,
  };
}
