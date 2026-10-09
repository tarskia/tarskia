import type { Entity, SchemaModule, SemanticDocument } from '@tarskia/diagram-semantics';
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type Node,
  type OnMove,
  type OnMoveStart,
  type ReactFlowInstance,
  useNodesState,
} from 'reactflow';
import type { GetCurrentCanvasSize } from '../diagram/canvas-size';
import type {
  MotionPhase,
  NavigationIntent,
  NavigationRequestResult,
} from '../diagram/motion-types';
import type { NodeVisualMode } from '../node-visual-mode';
import type { CanvasSemanticBindings } from '../viewer-core/view-models';
import type { CompileResult } from './compiler/compile';
import type { EdgeOverlayInteractionBindings } from './components/edges/EdgeOverlay';
import { resolveCachedEdgeOverlayRenderState } from './components/edges/edge-overlay-state';
import type { DiagramCanvasProps } from './DiagramCanvas';
import { collapseFocusShellDescriptors } from './focus-shells';
import { adaptPresentationToReactFlow } from './host/reactflow/adapter';
import type {
  CanvasEdgeHostControls,
  CanvasInteractionBindings,
  CanvasNodeHostControls,
  ReactFlowHostRenderState,
} from './host/reactflow/types';
import type { GraphModel } from './rendering/graph/graph-model';
import type {
  CanvasOverlayEdgeView,
  CanvasPresentation,
} from './rendering/presentation/presentation';
import type {
  TransitionOverlayFrame,
  TransitionOverlayState,
} from './rendering/transition/overlay';

export interface UseCanvasSurfaceControllerArgs {
  surface: {
    canvasRef: MutableRefObject<HTMLDivElement | null>;
    onCanvasElementChange: (element: HTMLDivElement | null) => void;
    onCanvasInit: (instance: ReactFlowInstance) => void;
    onCanvasUnmount: () => void;
    onLeftOcclusionChange: (leftOcclusion: number) => void;
    showDebug: boolean;
    getCurrentCanvasSize: GetCurrentCanvasSize;
    canvasLayoutVersion: number;
    minZoom: number;
    maxZoom: number;
    nodeVisualMode: NodeVisualMode;
    nodeTypes: DiagramCanvasProps['nodeTypes'];
  };
  graphState: {
    doc: SemanticDocument;
    schema: SchemaModule;
    graph: GraphModel;
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
    notifyDisplayHostSettled: (generation: number) => void;
    presentation: CanvasPresentation;
    compiled: CompileResult;
    transitionOverlay: TransitionOverlayState | null;
    transitionOverlayFrame: TransitionOverlayFrame | null;
    hideHostVisuals: boolean;
    transitionLiteMode: boolean;
    isTransitionRunning: boolean;
    isTransitionQueued: boolean;
    motionPhase: MotionPhase;
    requiredHostGeneration: number | null;
    frameDurations: number[];
  };
  telemetry: {
    traceSelection?: (event: string, payload?: Record<string, unknown>) => void;
  };
}

const FOCUS_SHELL_OUTER_INSET_X = 18;
const FOCUS_SHELL_OUTER_INSET_Y = 18;
const FOCUS_SHELL_STEP_X = 16;
const FOCUS_SHELL_STEP_Y = 32;
const toSingleSelectionSet = (id?: string) => (id ? new Set([id]) : new Set<string>());
const hostRenderStateSignatureCache = new WeakMap<ReactFlowHostRenderState, string>();

const formatDebugPoint = (point: { x: number; y: number }) =>
  `${Math.round(point.x)},${Math.round(point.y)}`;

const formatDebugRect = (rect: { x: number; y: number; width: number; height: number }) =>
  `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;

export const resolveVisibleHostOverlayEdges = (params: {
  overlayEdges: CanvasOverlayEdgeView[];
  hideHostVisuals: boolean;
  suppressForViewportGesture: boolean;
}) => {
  const { overlayEdges, hideHostVisuals } = params;
  return hideHostVisuals ? [] : overlayEdges;
};

export const getHostRenderStateSignature = (state: ReactFlowHostRenderState) => {
  const cached = hostRenderStateSignatureCache.get(state);
  if (cached) {
    return cached;
  }
  const signature = JSON.stringify(state, (_key, value) =>
    typeof value === 'function' ? '__function__' : value,
  );
  hostRenderStateSignatureCache.set(state, signature);
  return signature;
};

export const buildAutoVisibleSelectionKey = (params: {
  selectedEntityId?: string;
  canvasLayoutVersion?: number;
  leftOcclusion?: number;
}) => {
  const { selectedEntityId, canvasLayoutVersion = 0, leftOcclusion } = params;
  if (!selectedEntityId) {
    return null;
  }
  // Keep selection auto-reveal tied to user selection and viewport geometry,
  // not layout-driven node movement during unrelated expand/collapse transitions.
  return [
    selectedEntityId,
    `layout:${canvasLayoutVersion}`,
    `${Math.round(Math.max(0, leftOcclusion ?? 0))}`,
  ].join(':');
};

export const shouldCommitAutoVisibleSelectionKey = (result: NavigationRequestResult) =>
  result.status === 'queued' || result.status === 'applied';

export const shouldAcknowledgeDisplayGenerationImmediately = (params: {
  hostRenderChanged: boolean;
  requiredHostGeneration: number | null;
  notifiedDisplayGeneration: number | null;
}) => {
  const { hostRenderChanged, requiredHostGeneration, notifiedDisplayGeneration } = params;
  return (
    !hostRenderChanged &&
    requiredHostGeneration !== null &&
    requiredHostGeneration !== notifiedDisplayGeneration
  );
};

export const shouldSuppressHostInteractiveControls = (transitionLiteMode: boolean) =>
  transitionLiteMode;

export const shouldSuppressHostEdgeChrome = (params: {
  transitionLiteMode: boolean;
  motionPhase: MotionPhase;
  hasTransitionOverlay: boolean;
  hasQueuedStructuralTransition: boolean;
}) => {
  const { transitionLiteMode, motionPhase, hasTransitionOverlay, hasQueuedStructuralTransition } =
    params;
  return (
    transitionLiteMode ||
    (motionPhase === 'animating' && !hasTransitionOverlay && hasQueuedStructuralTransition)
  );
};

export const resolveSelectedEdgeEndpointHighlights = (
  presentation: CanvasPresentation,
  selectedRelationIds?: Set<string>,
) => {
  const highlightedSourceNodeIds = new Set<string>();
  const highlightedTargetNodeIds = new Set<string>();
  if (!selectedRelationIds || selectedRelationIds.size === 0) {
    return {
      highlightedSourceNodeIds,
      highlightedTargetNodeIds,
    };
  }
  for (const edge of presentation.overlayEdges) {
    const representedRelationIds = edge.relationIds ?? [edge.relationId];
    if (!representedRelationIds.some((relationId) => selectedRelationIds.has(relationId))) {
      continue;
    }
    highlightedSourceNodeIds.add(edge.sourceId);
    highlightedTargetNodeIds.add(edge.targetId);
  }
  return {
    highlightedSourceNodeIds,
    highlightedTargetNodeIds,
  };
};

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
  telemetry,
}: UseCanvasSurfaceControllerArgs) {
  const {
    canvasRef,
    onCanvasElementChange,
    onCanvasInit,
    onCanvasUnmount,
    onLeftOcclusionChange,
    showDebug,
    getCurrentCanvasSize,
    canvasLayoutVersion,
    minZoom,
    maxZoom,
    nodeVisualMode,
    nodeTypes,
  } = surface;
  const [leftOcclusion, setLeftOcclusion] = useState(0);
  const {
    doc,
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
    notifyDisplayHostSettled,
    presentation,
    compiled,
    transitionOverlay,
    transitionOverlayFrame,
    hideHostVisuals,
    transitionLiteMode,
    isTransitionRunning,
    isTransitionQueued,
    motionPhase,
    requiredHostGeneration,
    frameDurations,
  } = transition;
  const { traceSelection } = telemetry;
  const [zoom, setZoom] = useState(1);
  const zoomDebounceRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const suppressPaneClickRef = useRef(false);
  const autoVisibleSelectionKeyRef = useRef<string | null>(null);
  const viewportGestureActiveRef = useRef(false);
  const pendingDisplayGenerationRef = useRef<number | null>(null);
  const notifiedDisplayGenerationRef = useRef<number | null>(null);
  const lastAppliedHostRenderStateSignatureRef = useRef<string | null>(null);
  const suppressPaneClickOnce = useCallback(() => {
    // Ignore the immediate pane click after node/edge/popup interactions.
    suppressPaneClickRef.current = true;
    globalThis.setTimeout(() => {
      suppressPaneClickRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomDebounceRef.current) {
        globalThis.clearTimeout(zoomDebounceRef.current);
      }
    };
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
    if (!focusRootId) {
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
  }, [entityIndex.byId, focusRootId, focusShellHue, focusShellViews, semantic]);
  const handleEdgeSelect = useCallback(
    (edgeId: string) => {
      traceSelection?.('onEdgeClick', { edgeId, relationId: edgeId });
      setSelectedEntity(undefined);
      setSelectedEdge(edgeId);
      suppressPaneClickOnce();
    },
    [setSelectedEdge, setSelectedEntity, suppressPaneClickOnce, traceSelection],
  );

  const handleEdgeLabelClick = useCallback(
    (edgeId: string) => {
      setSelectedEdge(edgeId);
      setSelectedEntity(undefined);
      suppressPaneClickOnce();
    },
    [setSelectedEdge, setSelectedEntity, suppressPaneClickOnce],
  );

  const onMoveStart: OnMoveStart = useCallback((event) => {
    if (!shouldHandleViewportGestureEvent(event)) {
      return;
    }
  }, []);

  const onMove: OnMove = useCallback(
    (event, viewport) => {
      if (!viewportGestureActiveRef.current && !shouldHandleViewportGestureEvent(event)) {
        return;
      }
      if (!viewportGestureActiveRef.current) {
        reportUserGestureStart();
      }
      viewportGestureActiveRef.current = true;
      if (zoomDebounceRef.current) {
        globalThis.clearTimeout(zoomDebounceRef.current);
      }
      zoomDebounceRef.current = globalThis.setTimeout(() => {
        setZoom(viewport.zoom);
      }, 140);
      reportUserGestureMove({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    },
    [reportUserGestureMove, reportUserGestureStart],
  );

  const onMoveEnd: OnMove = useCallback(
    (event, viewport) => {
      if (!viewportGestureActiveRef.current && !shouldHandleViewportGestureEvent(event)) {
        return;
      }
      viewportGestureActiveRef.current = false;
      if (zoomDebounceRef.current) {
        globalThis.clearTimeout(zoomDebounceRef.current);
      }
      setZoom(viewport.zoom);
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

  const suppressHostEdgeChrome = shouldSuppressHostEdgeChrome({
    transitionLiteMode,
    motionPhase,
    hasTransitionOverlay: Boolean(transitionOverlay),
    hasQueuedStructuralTransition: isTransitionQueued,
  });

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

  const buildEdgeControlsById = useCallback(
    (selectedIds?: Set<string>) => {
      const relationById = new Map(doc.relations.map((rel) => [rel.id, rel]));
      const relationTypeById = new Map(schema.relations.map((relation) => [relation.id, relation]));
      const labeledEdgeIds = new Set<string>();
      const edgeGroups = new Map<
        string,
        Array<{ edgeId: string; relationId: string; priority: number; order: number }>
      >();
      const routedEdges = decoratedPresentation.overlayEdges.filter(
        (edge) => edge.kind === 'routed',
      );
      for (let index = 0; index < routedEdges.length; index += 1) {
        const edge = routedEdges[index];
        if (!edge) continue;
        const relation = relationById.get(edge.relationId);
        const relationType = relation?.type ? relationTypeById.get(relation.type) : undefined;
        const priority = relationType?.priority ?? Number.POSITIVE_INFINITY;
        const key = `${edge.sourceId}->${edge.targetId}`;
        const list = edgeGroups.get(key) ?? [];
        list.push({
          edgeId: edge.id,
          relationId: edge.relationId,
          priority,
          order: index,
        });
        edgeGroups.set(key, list);
      }
      for (const group of edgeGroups.values()) {
        group.sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          if (a.relationId !== b.relationId) return a.relationId.localeCompare(b.relationId);
          return a.order - b.order;
        });
        const primary = group[0];
        if (primary) {
          labeledEdgeIds.add(primary.edgeId);
        }
      }
      const controlsById = new Map<string, CanvasEdgeHostControls>();
      for (const edge of decoratedPresentation.overlayEdges) {
        const representedRelationIds = edge.relationIds ?? [edge.relationId];
        controlsById.set(edge.id, {
          selected: representedRelationIds.some((relationId) => selectedIds?.has(relationId)),
          hideLabel:
            edge.kind === 'routed' ? suppressHostEdgeChrome || !labeledEdgeIds.has(edge.id) : false,
        });
      }
      return controlsById;
    },
    [decoratedPresentation.overlayEdges, doc.relations, schema.relations, suppressHostEdgeChrome],
  );

  const buildNodeControlsById = useCallback(
    (selectedIds?: Set<string>, selectedRelationIds?: Set<string>) => {
      const { highlightedSourceNodeIds, highlightedTargetNodeIds } =
        resolveSelectedEdgeEndpointHighlights(decoratedPresentation, selectedRelationIds);
      const controlsById = new Map<string, CanvasNodeHostControls>();
      const suppressInteractiveControls = shouldSuppressHostInteractiveControls(transitionLiteMode);
      for (const node of decoratedPresentation.nodes) {
        controlsById.set(node.id, {
          selected: selectedIds?.has(node.id) ?? false,
          disableControlActions: suppressInteractiveControls,
          hideLocalEdgeLabels: suppressHostEdgeChrome,
          showConnectionHandles: true,
          highlightSourceHandle: highlightedSourceNodeIds.has(node.id),
          highlightTargetHandle: highlightedTargetNodeIds.has(node.id),
        });
      }
      return controlsById;
    },
    [decoratedPresentation, suppressHostEdgeChrome, transitionLiteMode],
  );

  const buildHostRenderState = useCallback(
    (selectedNodeIds?: Set<string>, selectedRelationIds?: Set<string>): ReactFlowHostRenderState =>
      adaptPresentationToReactFlow({
        presentation: decoratedPresentation,
        bindings: interactionBindings,
        nodeControlsById: buildNodeControlsById(selectedNodeIds, selectedRelationIds),
        edgeControlsById: buildEdgeControlsById(selectedRelationIds),
      }),
    [buildEdgeControlsById, buildNodeControlsById, decoratedPresentation, interactionBindings],
  );

  const initialFlowStateRef = useRef<ReactFlowHostRenderState | null>(null);
  if (!initialFlowStateRef.current) {
    initialFlowStateRef.current = buildHostRenderState();
  }
  const [nodes, setNodes, onNodesChange] = useNodesState(initialFlowStateRef.current.nodes);
  const [overlayEdges, setOverlayEdges] = useState(initialFlowStateRef.current.overlayEdges);
  const [edgeGeometrySnapshot, setEdgeGeometrySnapshot] = useState(presentation);
  const hostRenderState = useMemo(
    () =>
      buildHostRenderState(
        toSingleSelectionSet(selectedEntityId),
        toSingleSelectionSet(selectedEdgeId),
      ),
    [buildHostRenderState, selectedEdgeId, selectedEntityId],
  );
  const hostRenderStateSignature = useMemo(
    () => getHostRenderStateSignature(hostRenderState),
    [hostRenderState],
  );

  useLayoutEffect(() => {
    const hostRenderChanged =
      lastAppliedHostRenderStateSignatureRef.current !== hostRenderStateSignature;
    if (hostRenderChanged) {
      setNodes(hostRenderState.nodes);
      setOverlayEdges(hostRenderState.overlayEdges);
      lastAppliedHostRenderStateSignatureRef.current = hostRenderStateSignature;
    }
    setEdgeGeometrySnapshot(presentation);
    pendingDisplayGenerationRef.current = requiredHostGeneration;

    if (
      shouldAcknowledgeDisplayGenerationImmediately({
        hostRenderChanged,
        requiredHostGeneration,
        notifiedDisplayGeneration: notifiedDisplayGenerationRef.current,
      })
    ) {
      notifyDisplayHostSettled(requiredHostGeneration);
      notifiedDisplayGenerationRef.current = requiredHostGeneration;
      pendingDisplayGenerationRef.current = null;
    }
  }, [
    hostRenderState,
    hostRenderStateSignature,
    presentation,
    notifyDisplayHostSettled,
    requiredHostGeneration,
    setNodes,
  ]);

  const selectedNodeView = useMemo(
    () => decoratedPresentation.nodes.find((node) => node.id === selectedEntityId),
    [decoratedPresentation.nodes, selectedEntityId],
  );

  const handleLeftOcclusionChange = useCallback(
    (nextLeftOcclusion: number) => {
      const resolvedLeftOcclusion = Math.max(0, nextLeftOcclusion);
      setLeftOcclusion((current) =>
        current === resolvedLeftOcclusion ? current : resolvedLeftOcclusion,
      );
      onLeftOcclusionChange(resolvedLeftOcclusion);
    },
    [onLeftOcclusionChange],
  );

  useLayoutEffect(() => {
    if (!selectedEntityId) {
      autoVisibleSelectionKeyRef.current = null;
      return;
    }
    const nextAutoVisibleSelectionKey = buildAutoVisibleSelectionKey({
      selectedEntityId,
      canvasLayoutVersion,
      leftOcclusion,
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
    leftOcclusion,
    motionPhase,
    requestNavigation,
    selectedEntityId,
    selectedNodeView,
  ]);

  useEffect(() => {
    void nodes;
    void overlayEdges;
    const generation = pendingDisplayGenerationRef.current;
    if (generation !== null && generation !== notifiedDisplayGenerationRef.current) {
      notifyDisplayHostSettled(generation);
      notifiedDisplayGenerationRef.current = generation;
    }
  }, [nodes, notifyDisplayHostSettled, overlayEdges]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const debugWindow = window as Window & {
      __TARSKIA_EDGE_OVERLAY_DEBUG__?: unknown;
    };
    if (!showDebug) {
      delete debugWindow.__TARSKIA_EDGE_OVERLAY_DEBUG__;
      return;
    }
    const overlayRenderState = resolveCachedEdgeOverlayRenderState(
      presentation,
      hostRenderState.overlayEdges,
    );
    const selectedEdgeTrace =
      selectedEdgeId === undefined
        ? null
        : (overlayRenderState.edges.find(
            (edge) =>
              edge.id === selectedEdgeId ||
              edge.relationId === selectedEdgeId ||
              (edge.relationIds ?? []).includes(selectedEdgeId),
          ) ?? null);
    debugWindow.__TARSKIA_EDGE_OVERLAY_DEBUG__ = {
      selectedEdgeId,
      overlayRenderState,
      selectedEdgeTrace,
    };
    return () => {
      delete debugWindow.__TARSKIA_EDGE_OVERLAY_DEBUG__;
    };
  }, [hostRenderState, selectedEdgeId, showDebug, presentation]);

  const debugSummary = useMemo(() => {
    // Keep debug geometry current without storing canvas dimensions in React state.
    void canvasLayoutVersion;
    if (!showDebug) return null;
    const allIds = graph.entities.map((entity) => entity.id);
    const layoutIds = compiled.scene.visibleIds;
    const renderedIds = new Set(hostRenderState.nodes.map((node) => node.id));
    const overlayEdges = decoratedPresentation.overlayEdges.length;
    const hiddenStateIds = nodes.filter((node) => node.hidden).map((node) => node.id);
    const missingSizeIds = nodes
      .filter((node) => !(node.width && node.height))
      .map((node) => node.id);
    const missingLayout = allIds.filter((id) => !layoutIds.has(id));
    const missingVisible = missingLayout;
    const missingRendered = allIds.filter((id) => !renderedIds.has(id));

    const topLevelNodes = decoratedPresentation.nodes.filter((node) => !node.parentId);
    const topLevelPositions = topLevelNodes.map((node) => {
      const x = node.rect.x;
      const y = node.rect.y;
      const width = node.rect.width;
      const height = node.rect.height;
      return `${node.id}(${Math.round(x)},${Math.round(y)},${Math.round(width)}x${Math.round(height)})`;
    });

    let topBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (const node of topLevelNodes) {
      const x = node.rect.x;
      const y = node.rect.y;
      const width = node.rect.width;
      const height = node.rect.height;
      if (!topBounds) {
        topBounds = { minX: x, minY: y, maxX: x + width, maxY: y + height };
      } else {
        topBounds.minX = Math.min(topBounds.minX, x);
        topBounds.minY = Math.min(topBounds.minY, y);
        topBounds.maxX = Math.max(topBounds.maxX, x + width);
        topBounds.maxY = Math.max(topBounds.maxY, y + height);
      }
    }

    const viewRect = (() => {
      const viewport = getCurrentViewport();
      const canvasSize = getCurrentCanvasSize();
      if (!canvasSize || !viewport) return null;
      const minX = -viewport.x / viewport.zoom;
      const minY = -viewport.y / viewport.zoom;
      const maxX = (-viewport.x + canvasSize.width) / viewport.zoom;
      const maxY = (-viewport.y + canvasSize.height) / viewport.zoom;
      return { minX, minY, maxX, maxY };
    })();

    const overflowParents = new Set<string>();
    const rectById = new Map(decoratedPresentation.nodes.map((node) => [node.id, node.rect]));
    for (const node of decoratedPresentation.nodes) {
      if (!node.parentId) continue;
      const parentRect = rectById.get(node.parentId);
      if (!parentRect) continue;
      const x = node.rect.x - parentRect.x;
      const y = node.rect.y - parentRect.y;
      if (
        x < 0 ||
        y < 0 ||
        x + node.rect.width > parentRect.width ||
        y + node.rect.height > parentRect.height
      ) {
        overflowParents.add(node.parentId);
      }
    }

    const transitionActive = isTransitionRunning || isTransitionQueued;
    const overlayRenderState = resolveCachedEdgeOverlayRenderState(
      presentation,
      hostRenderState.overlayEdges,
    );
    const selectedResolvedEdge =
      selectedEdgeId === undefined
        ? null
        : (overlayRenderState.edges.find(
            (edge) =>
              edge.id === selectedEdgeId ||
              edge.relationId === selectedEdgeId ||
              (edge.relationIds ?? []).includes(selectedEdgeId),
          ) ?? null);
    const frameStats = (() => {
      const samples = frameDurations;
      if (!samples.length) return null;
      const sorted = [...samples].sort((a, b) => a - b);
      const sum = samples.reduce((acc, value) => acc + value, 0);
      const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      const over16_7Count = samples.filter((value) => value > 16.7).length;
      const over25Count = samples.filter((value) => value > 25).length;
      const over33_3Count = samples.filter((value) => value > 33.3).length;
      return {
        avgMs: sum / samples.length,
        p95Ms: sorted[p95Index] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        sampleCount: samples.length,
        over16_7Count,
        over25Count,
        over33_3Count,
      };
    })();

    return {
      total: graph.entities.length,
      layout: layoutIds.size,
      visible: layoutIds.size,
      rendered: decoratedPresentation.nodes.length,
      overlayEdges,
      stateNodes: nodes.length,
      hiddenStateIds,
      hiddenStateCount: hiddenStateIds.length,
      missingSizeIds,
      missingSizeCount: missingSizeIds.length,
      transitionActive,
      missingLayout,
      missingVisible,
      missingRendered,
      topLevelPositions,
      topBounds,
      viewRect,
      overflowParents: Array.from(overflowParents),
      frameStats,
      selectedEdgeTrace: selectedResolvedEdge
        ? {
            id: selectedResolvedEdge.id,
            relationId: selectedResolvedEdge.relationId,
            relationIds: selectedResolvedEdge.relationIds,
            kind: selectedResolvedEdge.kind,
            sourceId: selectedResolvedEdge.sourceId,
            targetId: selectedResolvedEdge.targetId,
            scopeId: selectedResolvedEdge.scopeId,
            opacity: selectedResolvedEdge.opacity,
            sourceSide: selectedResolvedEdge.geometry.sourceSide,
            targetSide: selectedResolvedEdge.geometry.targetSide,
            sourcePoint: formatDebugPoint(selectedResolvedEdge.geometry.sourcePoint),
            targetPoint: formatDebugPoint(selectedResolvedEdge.geometry.targetPoint),
            solidOverNodeIds: selectedResolvedEdge.solidOverNodeIds,
            shellOccluderCount: overlayRenderState.shellOccluders.length,
            contentOccluderCount: overlayRenderState.contentOccluders.length,
            blockerOccluderCount: selectedResolvedEdge.blockerOccluders.length,
            blockerOccluders: selectedResolvedEdge.blockerOccluders.map(formatDebugRect),
            passes: {
              solid: true,
              blocked: selectedResolvedEdge.blockerOccluders.length > 0,
            },
          }
        : null,
    };
  }, [
    showDebug,
    graph.entities,
    compiled.scene.visibleIds,
    hostRenderState.nodes,
    decoratedPresentation.nodes,
    decoratedPresentation.overlayEdges.length,
    canvasLayoutVersion,
    frameDurations,
    getCurrentCanvasSize,
    isTransitionQueued,
    isTransitionRunning,
    nodes,
    getCurrentViewport,
    hostRenderState,
    selectedEdgeId,
    presentation,
  ]);

  const onNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      traceSelection?.('onNodeClick', { nodeId: node.id });
      setSelectedEntity(node.id);
      setSelectedEdge(undefined);
      suppressPaneClickOnce();
    },
    [setSelectedEdge, setSelectedEntity, suppressPaneClickOnce, traceSelection],
  );

  const onCanvasPaneClick = useCallback(() => {
    traceSelection?.('onPaneClick:start', {
      suppressPaneClick: suppressPaneClickRef.current,
      selectedEntityId,
      selectedEdgeId,
    });
    if (suppressPaneClickRef.current) {
      traceSelection?.('onPaneClick:suppressed');
      return;
    }
    traceSelection?.('onPaneClick:resolved', {
      nextSelectedEntityId: undefined,
      nextSelectedEdgeId: undefined,
    });
    setSelectedEntity(undefined);
    setSelectedEdge(undefined);
  }, [selectedEntityId, selectedEdgeId, setSelectedEdge, setSelectedEntity, traceSelection]);

  const overlayInteractionBindings = useMemo<EdgeOverlayInteractionBindings>(
    () => ({ onSelectEdge: handleEdgeSelect, onEdgeLabelClick: handleEdgeLabelClick }),
    [handleEdgeSelect, handleEdgeLabelClick],
  );

  const canvasProps: DiagramCanvasProps = {
    canvasRef,
    onCanvasElementChange,
    onLeftOcclusionChange: handleLeftOcclusionChange,
    nodeVisualMode,
    hideHostVisuals,
    nodes: nodes as Node[],
    edgeGeometrySnapshot,
    overlayEdges: resolveVisibleHostOverlayEdges({
      overlayEdges,
      hideHostVisuals,
      suppressForViewportGesture: false,
    }),
    overlayInteractionBindings,
    transitionOverlay: transitionOverlay ?? undefined,
    transitionOverlayFrame: transitionOverlayFrame ?? undefined,
    nodeTypes,
    onNodesChange,
    onNodeClick,
    onInit: onCanvasInit,
    onUnmount: onCanvasUnmount,
    onPaneClick: onCanvasPaneClick,
    onMoveStart,
    onMove,
    onMoveEnd,
    minZoom,
    maxZoom,
    showDebug,
    debugSummary,
    onSelectFocusShell: handleSelectFocusShell,
    focusShells: focusShellFrames,
  };

  return {
    zoom,
    setZoom,
    canvasProps,
  };
}
