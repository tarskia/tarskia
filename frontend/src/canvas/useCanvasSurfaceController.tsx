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
import type { Entity, SchemaModule, SemanticDocument } from '../semantic';
import type { CanvasSemanticBindings } from '../shell/view-models';
import type { CompileResult } from './compiler/compile';
import type { EdgeOverlayInteractionBindings } from './components/edges/EdgeOverlay';
import { resolveEdgeOverlayRenderState } from './components/edges/edge-overlay-state';
import type { DiagramCanvasProps, EdgeMenuState, EdgeSearchState } from './DiagramCanvas';
import { collapseFocusShellDescriptors } from './focus-shells';
import { adaptPresentationToReactFlow } from './host/reactflow/adapter';
import type {
  CanvasEdgeHostControls,
  CanvasInteractionBindings,
  CanvasNodeHostControls,
  ReactFlowHostRenderState,
} from './host/reactflow/types';
import type { GraphModel } from './rendering/graph/graph-model';
import type { CanvasPoint } from './rendering/presentation/geometry';
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
    screenToWorldPosition: (point: { x: number; y: number }) => { x: number; y: number };
    readOnly?: boolean;
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
    selectedEntity?: Entity;
    selectedEntityId?: string;
    selectedEdgeId?: string;
    focusRootId?: string;
    searchMatches?: {
      matchingEntityIds: Set<string>;
      matchingRelationIds: Set<string>;
    };
  };
  graphQueries: {
    canContainEntity: (parent: Entity, childType: string) => boolean;
    resolveDefaultEntityName: (
      typeId: string,
      requestedName: string | undefined,
      existingCount: number,
    ) => string | undefined;
  };
  semantic: CanvasSemanticBindings;
  graphActions: {
    setSelectedEntity: (id: string | undefined) => void;
    setSelectedEdge: (id: string | undefined) => void;
    addEntity: (typeId: string, parentId?: string, name?: string) => string;
    commitDoc: (
      updater: SemanticDocument | ((prev: SemanticDocument) => SemanticDocument),
      options?: { undoable?: boolean },
    ) => void;
    deleteEntities: (ids: string[]) => void;
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
    traceSelection: (event: string, payload?: Record<string, unknown>) => void;
  };
}

const FOCUS_SHELL_OUTER_INSET_X = 18;
const FOCUS_SHELL_OUTER_INSET_Y = 18;
const FOCUS_SHELL_STEP_X = 16;
const FOCUS_SHELL_STEP_Y = 32;
const toSingleSelectionSet = (id?: string) => (id ? new Set([id]) : new Set<string>());
const hostRenderStateSignatureCache = new WeakMap<ReactFlowHostRenderState, string>();

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

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
  graphQueries,
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
    screenToWorldPosition,
    readOnly = false,
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
    selectedEntity,
    selectedEntityId,
    selectedEdgeId,
    focusRootId,
    searchMatches,
  } = graphState;
  const { canContainEntity } = graphQueries;
  const {
    setSelectedEntity,
    setSelectedEdge,
    addEntity,
    commitDoc,
    deleteEntities,
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
  const edgeSearchInputRef = useRef<HTMLInputElement | null>(null);
  const edgeMenuInputRef = useRef<HTMLInputElement | null>(null);
  const autoVisibleSelectionKeyRef = useRef<string | null>(null);
  const viewportGestureActiveRef = useRef(false);
  const pendingDisplayGenerationRef = useRef<number | null>(null);
  const notifiedDisplayGenerationRef = useRef<number | null>(null);
  const lastAppliedHostRenderStateSignatureRef = useRef<string | null>(null);
  const [edgeSearch, setEdgeSearch] = useState<EdgeSearchState | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState | null>(null);
  const [draftConnection, setDraftConnection] =
    useState<DiagramCanvasProps['draftConnection']>(null);
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

  useEffect(() => {
    if (edgeSearch) {
      edgeSearchInputRef.current?.focus();
    }
  }, [edgeSearch]);

  useEffect(() => {
    if (edgeMenu) {
      edgeMenuInputRef.current?.focus();
    }
  }, [edgeMenu]);

  const candidateTypes = useMemo(() => {
    if (!edgeSearch) return [];
    return semantic.listCandidateTypes(edgeSearch.sourceId);
  }, [edgeSearch, semantic]);

  const searchQuery = edgeSearch?.query.trim().toLowerCase() ?? '';
  const filteredTypes = candidateTypes.filter(
    (type) =>
      type.label.toLowerCase().includes(searchQuery) || type.id.toLowerCase().includes(searchQuery),
  );
  const filteredEntities = !edgeSearch
    ? []
    : semantic
        .listCandidateEntities(edgeSearch.sourceId)
        .filter(
          (entity) =>
            entity.label.toLowerCase().includes(searchQuery) ||
            entity.id.toLowerCase().includes(searchQuery),
        );
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
      traceSelection('onEdgeClick', { edgeId, relationId: edgeId });
      setSelectedEntity(undefined);
      setSelectedEdge(edgeId);
      setEdgeSearch(null);
      setEdgeMenu(null);
      suppressPaneClickOnce();
    },
    [setSelectedEdge, setSelectedEntity, suppressPaneClickOnce, traceSelection],
  );

  const handleEdgeLabelClick = useCallback(
    (edgeId: string, x: number, y: number) => {
      setEdgeSearch(null);
      setEdgeMenu(readOnly ? null : { edgeId, x, y, query: '' });
      setSelectedEdge(edgeId);
      setSelectedEntity(undefined);
      suppressPaneClickOnce();
    },
    [readOnly, setSelectedEdge, setSelectedEntity, suppressPaneClickOnce],
  );

  const handleDrop: React.DragEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      if (readOnly) return;
      const typeId = event.dataTransfer.getData('application/semantic-type');
      if (!typeId) return;
      const selectedParent =
        selectedEntity && canContainEntity(selectedEntity, typeId) ? selectedEntity.id : undefined;
      addEntity(typeId, selectedParent);
    },
    [addEntity, canContainEntity, readOnly, selectedEntity],
  );

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (readOnly) return;
      deleteEntities(deleted.map((node) => node.id));
      setEdgeSearch(null);
      setEdgeMenu(null);
    },
    [deleteEntities, readOnly],
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

  const handleCreateFromType = useCallback(
    (typeId: string) => {
      if (!edgeSearch) return;
      const name = edgeSearch.query.trim();
      const createdEntityId = semantic.createRelatedEntity(edgeSearch.sourceId, typeId, name);
      setEdgeSearch(null);
      if (createdEntityId) {
        setSelectedEntity(createdEntityId);
      }
    },
    [edgeSearch, semantic, setSelectedEntity],
  );

  const handleLinkEntity = useCallback(
    (targetId: string) => {
      if (!edgeSearch) return;
      semantic.createRelation(edgeSearch.sourceId, targetId);
      setEdgeSearch(null);
    },
    [edgeSearch, semantic],
  );

  const deleteSelectedRelation = useCallback(
    (relationId: string) => {
      commitDoc((prev) => ({
        ...prev,
        relations: prev.relations.filter((rel) => rel.id !== relationId),
      }));
      setSelectedEdge(undefined);
      setEdgeMenu(null);
      setEdgeSearch(null);
    },
    [commitDoc, setSelectedEdge],
  );

  const resolveWorldPoint = useCallback(
    (point: { x: number; y: number }): CanvasPoint => screenToWorldPosition(point),
    [screenToWorldPosition],
  );

  const handleDraftStart = useCallback(
    (sourceId: string, point: { x: number; y: number }) => {
      if (readOnly) {
        return;
      }
      const worldPoint = resolveWorldPoint(point);
      setDraftConnection({
        sourceId,
        sourcePoint: worldPoint,
        currentPoint: worldPoint,
      });
      setEdgeSearch(null);
      setEdgeMenu(null);
      suppressPaneClickOnce();
    },
    [readOnly, resolveWorldPoint, suppressPaneClickOnce],
  );

  const handleDraftMove = useCallback(
    (point: { x: number; y: number }, hoveredTargetId?: string) => {
      setDraftConnection((current) =>
        current
          ? {
              ...current,
              currentPoint: resolveWorldPoint(point),
              hoveredTargetId,
            }
          : current,
      );
    },
    [resolveWorldPoint],
  );

  const handleDraftEnd = useCallback(
    (point: { x: number; y: number }, hoveredTargetId?: string) => {
      let completedDraft: DiagramCanvasProps['draftConnection'] = null;
      setDraftConnection((current) => {
        completedDraft = current;
        return null;
      });
      if (!completedDraft) {
        return;
      }
      if (hoveredTargetId && hoveredTargetId !== completedDraft.sourceId) {
        semantic.createRelation(completedDraft.sourceId, hoveredTargetId);
      } else {
        setEdgeSearch({
          sourceId: completedDraft.sourceId,
          x: point.x,
          y: point.y,
          query: '',
        });
      }
      suppressPaneClickOnce();
    },
    [semantic, suppressPaneClickOnce],
  );

  const handleDraftCancel = useCallback(() => {
    setDraftConnection(null);
  }, []);

  const handleSelectFocusShell = useCallback(
    (entityId: string) => {
      setEdgeSearch(null);
      setEdgeMenu(null);
      setSelectedEdge(undefined);
      setSelectedEntity(entityId);
      setDraftConnection(null);
    },
    [setSelectedEdge, setSelectedEntity],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (readOnly || !selectedEdgeId) return;
      if (isEditableTarget(event.target)) return;
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      event.preventDefault();
      deleteSelectedRelation(selectedEdgeId);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelectedRelation, readOnly, selectedEdgeId]);

  const edgeOptions = useMemo(() => {
    if (!edgeMenu) return [];
    return semantic.listRelationOptions(edgeMenu.edgeId);
  }, [edgeMenu, semantic]);

  const edgeQuery = edgeMenu?.query.trim().toLowerCase() ?? '';
  const filteredEdgeOptions = edgeOptions.filter(
    (option) =>
      option.label.toLowerCase().includes(edgeQuery) || option.id.toLowerCase().includes(edgeQuery),
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
    const overlayRenderState = resolveEdgeOverlayRenderState({
      edges: hostRenderState.overlayEdges,
      nodes: hostRenderState.nodes.flatMap((node) => (node.data?.view ? [node.data.view] : [])),
    });
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
  }, [hostRenderState, selectedEdgeId, showDebug]);

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
    const overlayRenderState = resolveEdgeOverlayRenderState({
      edges: hostRenderState.overlayEdges,
      nodes: hostRenderState.nodes.flatMap((node) => (node.data?.view ? [node.data.view] : [])),
    });
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
  ]);

  const onNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      traceSelection('onNodeClick', { nodeId: node.id });
      setSelectedEntity(node.id);
      setSelectedEdge(undefined);
      setEdgeSearch(null);
      setEdgeMenu(null);
      setDraftConnection(null);
      suppressPaneClickOnce();
    },
    [setSelectedEdge, setSelectedEntity, suppressPaneClickOnce, traceSelection],
  );

  const onCanvasPaneClick = useCallback(() => {
    traceSelection('onPaneClick:start', {
      suppressPaneClick: suppressPaneClickRef.current,
      selectedEntityId,
      selectedEdgeId,
    });
    if (suppressPaneClickRef.current) {
      traceSelection('onPaneClick:suppressed');
      return;
    }
    traceSelection('onPaneClick:resolved', {
      nextSelectedEntityId: undefined,
      nextSelectedEdgeId: undefined,
    });
    setEdgeSearch(null);
    setEdgeMenu(null);
    setDraftConnection(null);
    setSelectedEntity(undefined);
    setSelectedEdge(undefined);
  }, [selectedEntityId, selectedEdgeId, setSelectedEdge, setSelectedEntity, traceSelection]);

  const onCanvasDragOver = useCallback<React.DragEventHandler<HTMLDivElement>>((event) => {
    event.preventDefault();
  }, []);

  const clearCanvasTransientState = useCallback(() => {
    setDraftConnection(null);
    setEdgeSearch(null);
    setEdgeMenu(null);
  }, []);

  const overlayInteractionBindings = useMemo<EdgeOverlayInteractionBindings>(
    () => ({
      onSelectEdge: handleEdgeSelect,
      onEdgeLabelClick: handleEdgeLabelClick,
      onDraftStart: handleDraftStart,
      onDraftMove: handleDraftMove,
      onDraftEnd: handleDraftEnd,
      onDraftCancel: handleDraftCancel,
    }),
    [
      handleDraftCancel,
      handleDraftEnd,
      handleDraftMove,
      handleDraftStart,
      handleEdgeLabelClick,
      handleEdgeSelect,
    ],
  );

  const canvasProps: DiagramCanvasProps = {
    canvasRef,
    onCanvasElementChange,
    onLeftOcclusionChange: handleLeftOcclusionChange,
    readOnly,
    nodeVisualMode,
    hideHostVisuals,
    onDrop: handleDrop,
    onDragOver: onCanvasDragOver,
    nodes: nodes as Node[],
    overlayEdges: resolveVisibleHostOverlayEdges({
      overlayEdges,
      hideHostVisuals,
      suppressForViewportGesture: false,
    }),
    overlayInteractionBindings,
    draftConnection,
    transitionOverlay: transitionOverlay ?? undefined,
    transitionOverlayFrame: transitionOverlayFrame ?? undefined,
    nodeTypes,
    onNodesChange,
    onNodeClick,
    onInit: onCanvasInit,
    onUnmount: onCanvasUnmount,
    onNodesDelete: handleNodesDelete,
    onPaneClick: onCanvasPaneClick,
    onMoveStart,
    onMove,
    onMoveEnd,
    minZoom,
    maxZoom,
    showDebug,
    debugSummary,
    edgeSearch,
    edgeSearchInputRef,
    setEdgeSearch,
    filteredTypes,
    filteredEntities,
    onCreateFromType: handleCreateFromType,
    onLinkEntity: handleLinkEntity,
    edgeMenu,
    edgeMenuInputRef,
    setEdgeMenu,
    filteredEdgeOptions,
    onSetRelationType: semantic.setRelationType,
    onApplyRelationOption: semantic.applyRelationOption,
    onSelectFocusShell: handleSelectFocusShell,
    focusShells: focusShellFrames,
  };

  return {
    zoom,
    setZoom,
    clearCanvasTransientState,
    canvasProps,
  };
}
