import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NavigationIntent, NavigationRequestResult } from '../diagram/motion-types';
import type { UseCanvasSurfaceControllerArgs } from './useCanvasSurfaceController';
import {
  buildAutoVisibleSelectionKey,
  getHostRenderStateSignature,
  resolveVisibleHostOverlayEdges,
  shouldAcknowledgeDisplayGenerationImmediately,
  shouldCommitAutoVisibleSelectionKey,
  shouldHandleViewportGestureEvent,
  shouldSuppressHostEdgeChrome,
  shouldSuppressHostInteractiveControls,
} from './useCanvasSurfaceController';

const testEdgeGeometry = {
  sourcePoint: { x: 0, y: 0 },
  control1: { x: 10, y: 0 },
  control2: { x: 90, y: 100 },
  targetPoint: { x: 100, y: 100 },
  path: 'M 0,0 L 100,100',
  labelAnchor: { x: 50, y: 50 },
  sourceSide: 'right' as const,
  targetSide: 'left' as const,
};

const buildTestGroupPresentation =
  (): import('./rendering/presentation/presentation').CanvasPresentation => ({
    nodes: [
      {
        id: 'group-1',
        kind: 'group',
        matched: false,
        rect: { x: 0, y: 0, width: 240, height: 160 },
        opacity: 1,
        contentScale: 1,
        content: {
          label: 'Group',
          entityType: 'Service',
          badges: [],
          summaryLabel: 'Details',
          listMode: false,
          listProps: [],
          listShowType: true,
        },
        style: {
          background: 'black',
          border: '1px solid white',
          color: 'white',
          selectionRing: 'white',
          selectionGlow: 'transparent',
          selectionFill: 'transparent',
          transparentChrome: false,
          focusShell: false,
        },
        controls: {
          targetId: 'group-1',
          showZoomControls: true,
          canZoomIn: false,
          canZoomOut: true,
          showDetailControls: true,
          canExpandDetails: false,
          canCollapseDetails: true,
          showChildGroupControls: true,
          canExpandChildGroups: false,
          canCollapseChildGroups: true,
        },
        capabilities: {
          hasChildren: true,
        },
      },
    ],
    overlayEdges: [],
  });

type UseCanvasSurfaceControllerTestGraphActions = {
  triggerEntityZoom: ReturnType<typeof vi.fn>;
  expandAllDetailsWithin: ReturnType<typeof vi.fn>;
  collapseAllDetailsWithin: ReturnType<typeof vi.fn>;
  expandChildGroupsWithin: ReturnType<typeof vi.fn>;
  collapseChildGroupsWithin: ReturnType<typeof vi.fn>;
};

async function renderController(params?: {
  semanticOverrides?: Partial<import('../viewer-core/view-models').CanvasSemanticBindings>;
  transitionOverrides?: {
    reportUserGestureMove?: ReturnType<typeof vi.fn>;
    reportUserGestureEnd?: ReturnType<typeof vi.fn>;
    requestNavigation?: ReturnType<typeof vi.fn>;
  };
  presentation?: import('./rendering/presentation/presentation').CanvasPresentation;
  selectedEntityId?: string;
  selectedEdgeId?: string;
  transitionLiteMode?: boolean;
  graphActionOverrides?: Partial<UseCanvasSurfaceControllerTestGraphActions>;
  canvasLayoutVersion?: number;
}) {
  vi.resetModules();
  vi.doUnmock('react');
  vi.doMock('reactflow', async () => {
    const actual = await vi.importActual<typeof import('reactflow')>('reactflow');
    return {
      ...actual,
      useNodesState: <T,>(initial: T[]) => [initial, vi.fn(), vi.fn()],
    };
  });

  const semanticBindings: import('../viewer-core/view-models').CanvasSemanticBindings = {
    getEntityDisplayName: vi.fn((entityId: string) => entityId),
    getEntityTypeLabel: vi.fn(() => 'Type'),
    getEntityFocusHue: vi.fn(() => undefined),
    ...params?.semanticOverrides,
  };

  const setSelectedEntity = vi.fn();
  const setSelectedEdge = vi.fn();
  const graphActions: UseCanvasSurfaceControllerTestGraphActions = {
    triggerEntityZoom: vi.fn(() => false),
    expandAllDetailsWithin: vi.fn(),
    collapseAllDetailsWithin: vi.fn(),
    expandChildGroupsWithin: vi.fn(),
    collapseChildGroupsWithin: vi.fn(),
    ...params?.graphActionOverrides,
  };
  const reportUserGestureMoveSpy = params?.transitionOverrides?.reportUserGestureMove ?? vi.fn();
  const reportUserGestureEndSpy = params?.transitionOverrides?.reportUserGestureEnd ?? vi.fn();
  const requestNavigationSpy =
    params?.transitionOverrides?.requestNavigation ??
    vi.fn((): NavigationRequestResult => ({ status: 'queued', reason: 'motion-plan' }));
  const reportUserGestureMove = (viewport: { x: number; y: number; zoom: number }) => {
    (
      reportUserGestureMoveSpy as unknown as (viewport: {
        x: number;
        y: number;
        zoom: number;
      }) => void
    )(viewport);
  };
  const reportUserGestureEnd = (viewport: { x: number; y: number; zoom: number }) => {
    (
      reportUserGestureEndSpy as unknown as (viewport: {
        x: number;
        y: number;
        zoom: number;
      }) => void
    )(viewport);
  };
  const requestNavigation = (intent: NavigationIntent) =>
    (requestNavigationSpy as unknown as (intent: NavigationIntent) => NavigationRequestResult)(
      intent,
    );
  let captured: ReturnType<
    typeof import('./useCanvasSurfaceController')['useCanvasSurfaceController']
  > | null = null;

  const React = await import('react');
  const { useCanvasSurfaceController } = await import('./useCanvasSurfaceController');

  function Harness() {
    captured = useCanvasSurfaceController({
      surface: {
        canvasRef: { current: null },
        onCanvasElementChange: vi.fn(),
        onCanvasInit: vi.fn(),
        onCanvasUnmount: vi.fn(),
        showDebug: false,
        getCurrentCanvasSize: vi.fn(() => null),
        canvasLayoutVersion: params?.canvasLayoutVersion ?? 0,
        minZoom: 0.05,
        maxZoom: 2,
        nodeVisualMode: 'default',
        nodeTypes: {},
      },
      graphState: {
        doc: {
          version: '1',
          schemaRefs: [],
          entities: [],
          relations: [{ id: 'rel-1', from: 'source-1', to: 'target-1' }],
        },
        schema: { owner: 'core', name: 'test', version: '1', types: [], relations: [] },
        graph: {
          entities: [],
          parentById: new Map(),
          childrenByParent: new Map(),
        } as never,
        entityIndex: {
          byId: new Map(),
          parentById: new Map(),
        },
        selectedEntityId: params?.selectedEntityId,
        selectedEdgeId: params?.selectedEdgeId,
        focusRootId: undefined,
      },
      semantic: semanticBindings,
      graphActions: {
        setSelectedEntity,
        setSelectedEdge,
        ...graphActions,
      } as UseCanvasSurfaceControllerArgs['graphActions'],
      transition: {
        getCurrentViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
        requestNavigation,
        reportUserGestureStart: vi.fn(),
        reportUserGestureMove,
        reportUserGestureEnd,
        notifyDisplayHostSettled: vi.fn(),
        presentation: params?.presentation ?? {
          nodes: [],
          overlayEdges: [],
        },
        compiled: {
          visibleIds: new Set<string>((params?.presentation?.nodes ?? []).map((node) => node.id)),
        } as never,
        transitionOverlay: null,
        overlayFrameStore: null,
        hideHostVisuals: false,
        transitionLiteMode: params?.transitionLiteMode ?? false,
        isTransitionRunning: false,
        isTransitionQueued: false,
        motionPhase: 'idle',
        requiredHostGeneration: null,
      },
    });
    return null;
  }

  renderToStaticMarkup(React.createElement(Harness));
  if (!captured) {
    throw new Error('Expected controller to render');
  }
  return {
    controller: captured,
    semanticBindings,
    setSelectedEntity,
    setSelectedEdge,
    reportUserGestureMove: reportUserGestureMoveSpy,
    reportUserGestureEnd: reportUserGestureEndSpy,
    requestNavigation: requestNavigationSpy,
  };
}

describe('useCanvasSurfaceController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('react');
    vi.doUnmock('reactflow');
  });

  it('acknowledges camera-only display generations immediately', () => {
    expect(
      shouldAcknowledgeDisplayGenerationImmediately({
        hostRenderChanged: false,
        requiredHostGeneration: 3,
        notifiedDisplayGeneration: 2,
      }),
    ).toBe(true);

    expect(
      shouldAcknowledgeDisplayGenerationImmediately({
        hostRenderChanged: true,
        requiredHostGeneration: 3,
        notifiedDisplayGeneration: 2,
      }),
    ).toBe(false);

    expect(
      shouldAcknowledgeDisplayGenerationImmediately({
        hostRenderChanged: false,
        requiredHostGeneration: 3,
        notifiedDisplayGeneration: 3,
      }),
    ).toBe(false);
  });

  it('suppresses host interactive controls during transition-lite phases', () => {
    expect(shouldSuppressHostInteractiveControls(true)).toBe(true);
    expect(shouldSuppressHostInteractiveControls(false)).toBe(false);
  });

  it('suppresses host edge chrome during transition-lite and queued structural camera phases', () => {
    expect(
      shouldSuppressHostEdgeChrome({
        transitionLiteMode: true,
        motionPhase: 'idle',
        hasTransitionOverlay: true,
        hasQueuedStructuralTransition: false,
      }),
    ).toBe(true);
    expect(
      shouldSuppressHostEdgeChrome({
        transitionLiteMode: false,
        motionPhase: 'animating',
        hasTransitionOverlay: false,
        hasQueuedStructuralTransition: true,
      }),
    ).toBe(true);
    expect(
      shouldSuppressHostEdgeChrome({
        transitionLiteMode: false,
        motionPhase: 'animating',
        hasTransitionOverlay: true,
        hasQueuedStructuralTransition: true,
      }),
    ).toBe(false);
    expect(
      shouldSuppressHostEdgeChrome({
        transitionLiteMode: false,
        motionPhase: 'animating',
        hasTransitionOverlay: false,
        hasQueuedStructuralTransition: false,
      }),
    ).toBe(false);
    expect(
      shouldSuppressHostEdgeChrome({
        transitionLiteMode: false,
        motionPhase: 'idle',
        hasTransitionOverlay: false,
        hasQueuedStructuralTransition: false,
      }),
    ).toBe(false);
  });

  it('keeps host overlay edges visible during viewport gestures and only hides them with the host', () => {
    const overlayEdges = [
      {
        id: 'rel-1:source->target',
        relationId: 'rel-1',
        kind: 'routed' as const,
        sourceId: 'source',
        targetId: 'target',
        matched: false,
        opacity: 1,
        geometry: testEdgeGeometry,
        path: testEdgeGeometry.path,
        labelAnchor: testEdgeGeometry.labelAnchor,
        solidOverNodeIds: ['group-1'],
      },
    ];

    expect(
      resolveVisibleHostOverlayEdges({
        overlayEdges,
        hideHostVisuals: false,
        suppressForViewportGesture: false,
      }),
    ).toBe(overlayEdges);
    expect(
      resolveVisibleHostOverlayEdges({
        overlayEdges,
        hideHostVisuals: false,
        suppressForViewportGesture: true,
      }),
    ).toBe(overlayEdges);
    expect(
      resolveVisibleHostOverlayEdges({
        overlayEdges,
        hideHostVisuals: true,
        suppressForViewportGesture: false,
      }),
    ).toEqual([]);
  });

  it('keys selection auto-reveal by selected node, canvas layout version', () => {
    const baseKey = buildAutoVisibleSelectionKey({
      selectedEntityId: 'node-1',
      canvasLayoutVersion: 1,
    });
    const resizedCanvasKey = buildAutoVisibleSelectionKey({
      selectedEntityId: 'node-1',
      canvasLayoutVersion: 2,
    });
    const movedNodeKey = buildAutoVisibleSelectionKey({
      selectedEntityId: 'node-1',
      canvasLayoutVersion: 1,
    });

    expect(baseKey).not.toBeNull();
    expect(resizedCanvasKey).not.toBeNull();
    expect(movedNodeKey).not.toBeNull();
    expect(resizedCanvasKey).not.toBe(baseKey);
    expect(movedNodeKey).toBe(baseKey);
  });

  it('does not build a selection auto-reveal key without a selected node', () => {
    expect(
      buildAutoVisibleSelectionKey({
        selectedEntityId: 'node-1',
        canvasLayoutVersion: 1,
      }),
    ).not.toBeNull();
    expect(
      buildAutoVisibleSelectionKey({
        canvasLayoutVersion: 1,
      }),
    ).toBeNull();
  });

  it('commits selection auto-reveal keys only for accepted navigation results', () => {
    expect(shouldCommitAutoVisibleSelectionKey({ status: 'queued', reason: 'motion-plan' })).toBe(
      true,
    );
    expect(shouldCommitAutoVisibleSelectionKey({ status: 'applied', reason: 'synchronous' })).toBe(
      true,
    );
    expect(shouldCommitAutoVisibleSelectionKey({ status: 'noop', reason: 'no-target' })).toBe(
      false,
    );
    expect(
      shouldCommitAutoVisibleSelectionKey({ status: 'unavailable', reason: 'missing-canvas' }),
    ).toBe(false);
  });

  it('treats semantically identical host render states as equal even when handlers are recreated', () => {
    const baseNodeView = buildTestGroupPresentation().nodes[0];
    const baseNodeBindings = {
      onZoomTrigger: vi.fn(),
      onExpandDetails: vi.fn(),
      onCollapseDetails: vi.fn(),
      onExpandChildGroups: vi.fn(),
      onCollapseChildGroups: vi.fn(),
      onEdgeLabelClick: vi.fn(),
      onSelectNode: vi.fn(),
      onSelectEdge: vi.fn(),
    };
    const baseEdgeView = {
      id: 'edge-1',
      relationId: 'rel-1',
      kind: 'routed' as const,
      sourceId: 'node-1',
      targetId: 'node-2',
      opacity: 1,
      matched: false,
      geometry: {
        sourcePoint: { x: 0, y: 0 },
        targetPoint: { x: 10, y: 10 },
        control1: { x: 2, y: 2 },
        control2: { x: 8, y: 8 },
        path: 'M0 0 C2 2 8 8 10 10',
        labelAnchor: { x: 5, y: 5 },
        sourceSide: 'right' as const,
        targetSide: 'left' as const,
      },
      path: 'M0 0 C2 2 8 8 10 10',
      labelAnchor: { x: 5, y: 5 },
      label: undefined,
      solidOverNodeIds: [],
    };
    const firstState: import('./host/reactflow/types').ReactFlowHostRenderState = {
      nodes: [
        {
          id: 'node-1',
          type: 'entityNode',
          position: { x: 10, y: 20 },
          data: {
            view: baseNodeView,
            bindings: baseNodeBindings,
            controls: {
              selected: false,
              disableControlActions: false,
              hideLocalEdgeLabels: false,
            },
          },
        } as import('reactflow').Node<import('./host/reactflow/types').ReactFlowHostNodeData>,
      ],
      overlayEdges: [baseEdgeView],
    };

    const secondState: import('./host/reactflow/types').ReactFlowHostRenderState = {
      nodes: [
        {
          ...firstState.nodes[0],
          data: {
            ...firstState.nodes[0].data,
            bindings: {
              onZoomTrigger: vi.fn(),
              onExpandDetails: vi.fn(),
              onCollapseDetails: vi.fn(),
              onExpandChildGroups: vi.fn(),
              onCollapseChildGroups: vi.fn(),
              onEdgeLabelClick: vi.fn(),
              onSelectNode: vi.fn(),
              onSelectEdge: vi.fn(),
            },
          },
        } as import('reactflow').Node<import('./host/reactflow/types').ReactFlowHostNodeData>,
      ],
      overlayEdges: [{ ...firstState.overlayEdges[0] }],
    };

    expect(getHostRenderStateSignature(firstState)).toBe(getHostRenderStateSignature(secondState));
  });

  it('preserves semantic node controls while applying a runtime disable mask', async () => {
    const { controller } = await renderController({
      presentation: buildTestGroupPresentation(),
      transitionLiteMode: true,
    });

    const hostNode = controller.canvasProps.nodes[0];
    const viewControls = hostNode?.data?.view.controls;
    const runtimeControls = hostNode?.data?.controls;

    expect(viewControls?.showDetailControls).toBe(true);
    expect(viewControls?.showChildGroupControls).toBe(true);
    expect(viewControls?.canCollapseDetails).toBe(true);
    expect(viewControls?.canCollapseChildGroups).toBe(true);
    expect(runtimeControls?.disableControlActions).toBe(true);
    expect(runtimeControls?.hideLocalEdgeLabels).toBe(true);
  });

  it('ignores non-user viewport move callbacks', () => {
    expect(shouldHandleViewportGestureEvent(null)).toBe(false);
    expect(shouldHandleViewportGestureEvent(undefined)).toBe(false);
    expect(shouldHandleViewportGestureEvent({})).toBe(false);
    expect(shouldHandleViewportGestureEvent({ type: 'zoom' })).toBe(false);
  });

  it('accepts pointer-like viewport move callbacks', () => {
    expect(
      shouldHandleViewportGestureEvent({
        clientX: 24,
        clientY: 18,
      }),
    ).toBe(true);
    expect(
      shouldHandleViewportGestureEvent({
        nativeEvent: {
          clientX: 24,
          clientY: 18,
        },
      }),
    ).toBe(true);
    expect(shouldHandleViewportGestureEvent({ sourceEvent: { buttons: 1 } })).toBe(false);
  });

  it('exposes overlay edge-selection bindings through the canvas props', async () => {
    const { controller, setSelectedEdge } = await renderController();

    controller.canvasProps.overlayInteractionBindings?.onSelectEdge?.('rel-1');

    expect(controller.canvasProps.overlayInteractionBindings).toBeDefined();
    expect(setSelectedEdge).toHaveBeenCalledWith('rel-1');
  });

  it('does not expose host edge callbacks on the flattened canvas contract', async () => {
    const { controller } = await renderController();

    expect('onConnect' in controller.canvasProps).toBe(false);
    expect('onConnectStart' in controller.canvasProps).toBe(false);
    expect('onConnectEnd' in controller.canvasProps).toBe(false);
    expect('onEdgesDelete' in controller.canvasProps).toBe(false);
  });

  it('reports completed viewport moves through the motion manager', async () => {
    const { controller, reportUserGestureEnd } = await renderController();

    controller.canvasProps.onMoveEnd({ clientX: 12, clientY: 24 } as MouseEvent, {
      x: 12,
      y: -20,
      zoom: 0.75,
    });

    expect(reportUserGestureEnd).toHaveBeenCalledWith({ x: 12, y: -20, zoom: 0.75 });
  });
});
