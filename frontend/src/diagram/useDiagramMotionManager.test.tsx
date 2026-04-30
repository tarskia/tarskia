import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayoutResult } from '../canvas/rendering/layout/layout-pipeline';
import {
  DEFAULT_ANIMATION_SETTINGS,
  DEFAULT_VIEWPORT_FIT_PADDING,
  FOCUS_SCOPE_CAMERA_PAUSE_MS,
} from '../canvas/rendering/transition/animation-constants';
import {
  buildStaticTransitionOverlayState,
  resolveTransitionOverlayFrame,
} from '../canvas/rendering/transition/overlay';
import {
  computeViewportForBoundsInVisibleCanvas,
  computeViewportToKeepRectVisible,
} from '../canvas/viewport-visibility';
import { indexTree } from '../semantic';
import {
  buildMotionPlanFromChoreographyRequest,
  buildRetainedOnlySnapshot,
  computePostOverlayBridgeViewport,
  computeStructuralCameraDurationMs,
  computeStructuralOverlayDurationMs,
  computeStructuralOverlayPhaseWindow,
  shouldDisplayTransitionOverlay,
  useDiagramMotionManager,
} from './useDiagramMotionManager';

const buildSnapshot = () => ({
  nodes: [
    {
      id: 'node-1',
      kind: 'entity' as const,
      matched: false,
      rect: { x: 0, y: 0, width: 120, height: 64 },
      opacity: 1,
      contentScale: 1,
      content: {
        label: 'Node',
        entityType: 'Type',
        badges: [],
        childOpacity: 1,
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
        targetId: 'node-1',
        showZoomControls: false,
        canZoomIn: false,
        canZoomOut: false,
        showDetailControls: false,
        canExpandDetails: false,
        canCollapseDetails: false,
        showChildGroupControls: false,
        canExpandChildGroups: false,
        canCollapseChildGroups: false,
      },
      capabilities: {
        hasChildren: false,
      },
    },
  ],
  overlayEdges: [],
});

const buildLayout = (): LayoutResult => {
  const root = {
    id: 'root',
    entity: {
      id: 'root',
      type: 'viewport',
      name: 'Root',
    },
    baseSize: { width: 0, height: 0 },
    size: { width: 0, height: 0 },
    children: [],
  };
  const tree = indexTree({
    rootId: 'root',
    byId: new Map([['root', root]]),
  });
  return {
    doc: { entities: [], relations: [] } as never,
    schema: { entities: [], relations: [] } as never,
    tree,
    visibleIds: new Set(),
    absolutePositions: {},
    zIndexById: new Map(),
    layoutMeta: { level: 0 },
  } as unknown as LayoutResult;
};

const buildEmptyPlanningAdvisory = (direction: 'in' | 'out') => ({
  direction,
  structure: {
    rootIds: { from: 'root', to: 'root' },
    nodeDiffs: new Map(),
    childVisibilityDiffs: [],
    edgeDiffs: [],
  },
  geometry: {
    basePositions: {},
    targetPositions: {},
    nodeGeometry: new Map(),
  },
  sequence: {
    steps: [],
    nodeAdvisories: new Map(),
    childFadeAdvisories: new Map(),
    edgeAdvisories: new Map(),
    controlSwitchAdvisories: new Map(),
  },
});

function renderManager(params?: {
  getCurrentCanvasSize?: () => { width: number; height: number } | null;
  initialViewport?: { x: number; y: number; zoom: number };
}) {
  const rawOnCanvasInit = vi.fn();
  const rawOnCanvasUnmount = vi.fn();
  let currentViewport = params?.initialViewport ?? { x: 0, y: 0, zoom: 1 };
  const getCurrentViewport = vi.fn(() => currentViewport);
  const getLeftOcclusion = vi.fn(() => 0);
  const getSceneBounds = vi.fn(() => ({ x: 0, y: 0, width: 480, height: 320 }));
  const getNodeSetBounds = vi.fn(() => ({ x: 120, y: 80, width: 240, height: 180 }));
  const setViewport = vi.fn((viewport: typeof currentViewport) => {
    currentViewport = viewport;
  });
  const persistViewport = vi.fn();
  let captured: ReturnType<typeof useDiagramMotionManager> | null = null;

  function Harness() {
    captured = useDiagramMotionManager({
      stableSnapshot: buildSnapshot(),
      animationSettings: DEFAULT_ANIMATION_SETTINGS,
      savedViewport: undefined,
      getCurrentCanvasSize: params?.getCurrentCanvasSize ?? (() => ({ width: 960, height: 640 })),
      minZoom: 0.5,
      maxZoom: 2,
      persistViewport,
      onCanvasInit: rawOnCanvasInit,
      onCanvasUnmount: rawOnCanvasUnmount,
      getCurrentViewport,
      getLeftOcclusion,
      getSceneBounds,
      getNodeSetBounds,
      setViewport,
    });
    return null;
  }

  renderToStaticMarkup(<Harness />);
  if (!captured) {
    throw new Error('Expected motion manager to render');
  }

  return {
    manager: captured,
    rawOnCanvasInit,
    rawOnCanvasUnmount,
    getCurrentViewport,
    getLeftOcclusion,
    getSceneBounds,
    getNodeSetBounds,
    setViewport,
    persistViewport,
  };
}

describe('useDiagramMotionManager', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now() + 200);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it('scales structural camera duration with viewport travel', () => {
    const baseDurationMs = DEFAULT_ANIMATION_SETTINGS.viewport.cameraDuration;

    const localDurationMs = computeStructuralCameraDurationMs({
      from: { x: 0, y: 0, zoom: 1 },
      to: { x: 40, y: 20, zoom: 1.02 },
      baseDurationMs,
      canvasSize: { width: 960, height: 640 },
    });
    const longTravelDurationMs = computeStructuralCameraDurationMs({
      from: { x: 0, y: 0, zoom: 1 },
      to: { x: 720, y: 360, zoom: 1.55 },
      baseDurationMs,
      canvasSize: { width: 960, height: 640 },
    });

    expect(localDurationMs).toBeGreaterThanOrEqual(baseDurationMs);
    expect(longTravelDurationMs).toBeGreaterThan(localDurationMs);
  });

  it('keeps structural overlay duration from collapsing below the choreography floor', () => {
    const overlayDurationMs = computeStructuralOverlayDurationMs({
      baseOverlayDurationMs: 180,
      choreographyCameraDurationMs: 420,
      hasStructuredPhases: true,
    });

    expect(overlayDurationMs).toBe(399);
  });

  it('trims leading no-op time from structural overlay phase windows', () => {
    const phaseWindow = computeStructuralOverlayPhaseWindow({
      totalDuration: 100,
      basePositions: {},
      targetPositions: {},
      nodeTimings: new Map([
        [
          'node-1',
          {
            moveX: { start: 0.08, end: 0.2 },
            resizeY: { start: 0.2, end: 0.4 },
          },
        ],
      ]),
      childFadeByParent: new Map(),
      edgePlans: [],
    });

    expect(phaseWindow).toEqual({ start: 0.08, end: 1 });
  });

  it('bridges a relaid scoped node set back to its pre-fade screen position', () => {
    const sourceSnapshot = {
      ...buildSnapshot(),
      nodes: buildSnapshot().nodes.map((node) => ({
        ...node,
        rect: { x: 420, y: 260, width: 160, height: 80 },
      })),
    };
    const targetSnapshot = {
      ...buildSnapshot(),
      nodes: buildSnapshot().nodes.map((node) => ({
        ...node,
        rect: { x: 0, y: 0, width: 320, height: 160 },
      })),
    };
    const currentViewport = { x: -120, y: 40, zoom: 0.5 };

    const bridge = computePostOverlayBridgeViewport({
      sourceSnapshot,
      targetSnapshot,
      nodeIds: ['node-1'],
      currentViewport,
      minZoom: 0.1,
      maxZoom: 2,
    });

    expect(bridge).toEqual({
      x: 90,
      y: 170,
      zoom: 0.25,
    });
  });

  it('can filter a snapshot down to retained focused nodes and their local edges', () => {
    const snapshot = {
      ...buildSnapshot(),
      nodes: [
        {
          ...buildSnapshot().nodes[0],
          id: 'node-1',
        },
        {
          ...buildSnapshot().nodes[0],
          id: 'node-2',
        },
        {
          ...buildSnapshot().nodes[0],
          id: 'context',
        },
      ],
      overlayEdges: [
        {
          id: 'retained-edge',
          relationId: 'retained-edge',
          kind: 'local' as const,
          sourceId: 'node-1',
          targetId: 'node-2',
          matched: false,
          opacity: 1,
          geometry: {
            sourcePoint: { x: 0, y: 0 },
            control1: { x: 0, y: 0 },
            control2: { x: 0, y: 0 },
            targetPoint: { x: 0, y: 0 },
            labelAnchor: { x: 0, y: 0 },
            sourceSide: 'right' as const,
            targetSide: 'left' as const,
            path: '',
          },
          path: '',
          labelAnchor: { x: 0, y: 0 },
          solidOverNodeIds: [],
        },
        {
          id: 'context-edge',
          relationId: 'context-edge',
          kind: 'local' as const,
          sourceId: 'node-1',
          targetId: 'context',
          matched: false,
          opacity: 1,
          geometry: {
            sourcePoint: { x: 0, y: 0 },
            control1: { x: 0, y: 0 },
            control2: { x: 0, y: 0 },
            targetPoint: { x: 0, y: 0 },
            labelAnchor: { x: 0, y: 0 },
            sourceSide: 'right' as const,
            targetSide: 'left' as const,
            path: '',
          },
          path: '',
          labelAnchor: { x: 0, y: 0 },
          solidOverNodeIds: [],
        },
      ],
    };

    const retained = buildRetainedOnlySnapshot(snapshot, ['node-1', 'node-2']);

    expect(retained.nodes.map((node) => node.id)).toEqual(['node-1', 'node-2']);
    expect(retained.overlayEdges.map((edge) => edge.id)).toEqual(['retained-edge']);
  });

  it('builds exit-focus choreography as retained-node bridge, scene camera, pause, then context fade', () => {
    const sourceSnapshot = {
      ...buildSnapshot(),
      nodes: buildSnapshot().nodes.map((node) => ({
        ...node,
        rect: { x: 420, y: 260, width: 160, height: 80 },
      })),
    };
    const targetSnapshot = {
      ...buildSnapshot(),
      nodes: [
        {
          ...buildSnapshot().nodes[0],
          rect: { x: 0, y: 0, width: 320, height: 160 },
        },
        {
          ...buildSnapshot().nodes[0],
          id: 'context',
          rect: { x: 520, y: 40, width: 120, height: 80 },
        },
      ],
    };

    const plan = buildMotionPlanFromChoreographyRequest({
      request: {
        direction: 'in',
        focus: null,
        startLayout: buildLayout(),
        endLayout: buildLayout(),
        startSnapshot: sourceSnapshot,
        endSnapshot: targetSnapshot,
        currentViewport: { x: -120, y: 40, zoom: 0.5 },
        endPointOfInterestNodeIds: [],
        pauseBeforeOverlayMs: FOCUS_SCOPE_CAMERA_PAUSE_MS,
        exitScopeRetainedNodeIds: ['node-1'],
        collectSubtreeIds: () => new Set<string>(),
        planningAdvisory: buildEmptyPlanningAdvisory('in'),
        persistFinalViewport: true,
      },
      animationSettings: DEFAULT_ANIMATION_SETTINGS,
      canvasSize: { width: 960, height: 640 },
      leftOcclusion: 0,
      minZoom: 0.1,
      maxZoom: 2,
    });

    expect(plan.segments).toHaveLength(4);
    expect(plan.segments[0]?.hostSnapshot?.nodes.map((node) => node.id)).toEqual(['node-1']);
    expect(plan.segments[0]?.camera?.to).toEqual({
      x: 90,
      y: 170,
      zoom: 0.25,
    });
    expect(plan.segments[1]?.camera?.from).toEqual(plan.segments[0]?.camera?.to);
    expect(plan.segments[1]?.camera?.to).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: { x: 0, y: 0, width: 640, height: 160 },
        canvas: { width: 960, height: 640 },
        minZoom: 0.1,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
        leftOcclusion: 0,
      }),
    );
    expect(plan.segments[2]).toEqual({ durationMs: FOCUS_SCOPE_CAMERA_PAUSE_MS });
    expect(plan.segments[3]?.overlay?.incomingSnapshot).toBe(targetSnapshot);
  });

  it('pauses after the enter-focus fade before completing to navigation', () => {
    const sourceSnapshot = {
      ...buildSnapshot(),
      nodes: buildSnapshot().nodes.map((node) => ({
        ...node,
        rect: { x: 420, y: 260, width: 160, height: 80 },
      })),
    };
    const targetSnapshot = {
      ...buildSnapshot(),
      nodes: buildSnapshot().nodes.map((node) => ({
        ...node,
        rect: { x: 0, y: 0, width: 320, height: 160 },
      })),
    };

    const plan = buildMotionPlanFromChoreographyRequest({
      request: {
        direction: 'out',
        focus: null,
        startLayout: buildLayout(),
        endLayout: buildLayout(),
        startSnapshot: sourceSnapshot,
        endSnapshot: targetSnapshot,
        currentViewport: { x: -120, y: 40, zoom: 0.5 },
        endPointOfInterestNodeIds: [],
        pauseAfterOverlayMs: FOCUS_SCOPE_CAMERA_PAUSE_MS,
        postOverlayViewportBridgeNodeIds: ['node-1'],
        sharedNodeGeometry: 'freeze-from',
        collectSubtreeIds: () => new Set<string>(),
        planningAdvisory: buildEmptyPlanningAdvisory('out'),
        persistFinalViewport: true,
      },
      animationSettings: DEFAULT_ANIMATION_SETTINGS,
      canvasSize: { width: 960, height: 640 },
      leftOcclusion: 0,
      minZoom: 0.1,
      maxZoom: 2,
    });

    const finalSegment = plan.segments[plan.segments.length - 1];

    expect(plan.segments[0]?.overlay?.incomingSnapshot).toBe(targetSnapshot);
    expect(finalSegment).toEqual({ durationMs: FOCUS_SCOPE_CAMERA_PAUSE_MS });
  });

  it('keeps the host visible while an animating overlay still matches the outgoing snapshot', () => {
    const hostSnapshot = buildSnapshot();
    const transitionOverlay = buildStaticTransitionOverlayState({
      snapshot: hostSnapshot,
      id: 1,
      startedAt: 0,
    });
    const transitionOverlayFrame = resolveTransitionOverlayFrame(transitionOverlay, 0);

    expect(
      shouldDisplayTransitionOverlay({
        phase: 'animating',
        hostSnapshot,
        transitionOverlay,
        transitionOverlayFrame,
      }),
    ).toBe(false);
    expect(
      shouldDisplayTransitionOverlay({
        phase: 'settling',
        hostSnapshot,
        transitionOverlay,
        transitionOverlayFrame,
      }),
    ).toBe(true);
  });

  it('waits for the display host barrier before executing fit-scene navigation', () => {
    const { manager, setViewport } = renderManager();

    manager.onCanvasInit({} as never);
    manager.requestNavigation({
      kind: 'fit-scene',
      preset: 'search-reveal',
      duration: 0,
    });

    expect(setViewport).not.toHaveBeenCalled();

    manager.notifyDisplayHostSettled(1);

    expect(setViewport).toHaveBeenCalledWith(
      computeViewportForBoundsInVisibleCanvas({
        bounds: { x: 0, y: 0, width: 480, height: 320 },
        canvas: { width: 960, height: 640 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
        leftOcclusion: 0,
      }),
    );
  });

  it('can defer fit-scene navigation until the next frame so it uses updated scene bounds', () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });

    const { manager, getSceneBounds, setViewport } = renderManager();
    let currentBounds = { x: 0, y: 0, width: 240, height: 160 };
    getSceneBounds.mockImplementation(() => currentBounds);

    manager.onCanvasInit({} as never);

    const result = manager.requestNavigation({
      kind: 'fit-scene',
      duration: 0,
      persist: false,
      waitForHostSettle: true,
      deferUntilNextFrame: true,
    });

    expect(result).toEqual({ status: 'queued', reason: 'deferred-frame' });
    expect(setViewport).not.toHaveBeenCalled();

    currentBounds = { x: 120, y: 80, width: 360, height: 240 };
    const deferredFrame = queuedFrames.shift();
    if (!deferredFrame) {
      throw new Error('Expected deferred navigation frame');
    }
    deferredFrame(performance.now());

    expect(setViewport).not.toHaveBeenCalled();

    manager.notifyDisplayHostSettled(1);

    expect(setViewport).toHaveBeenCalledWith(
      computeViewportForBoundsInVisibleCanvas({
        bounds: currentBounds,
        canvas: { width: 960, height: 640 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
        leftOcclusion: 0,
      }),
    );
  });

  it('fits an explicit rect for focus navigation after the host settles', () => {
    const { manager, setViewport } = renderManager();
    const rect = { x: 120, y: 80, width: 240, height: 180 };

    manager.onCanvasInit({} as never);
    manager.requestNavigation({
      kind: 'fit-rect',
      rect,
      preset: 'focus',
      duration: 0,
    });

    expect(setViewport).not.toHaveBeenCalled();

    manager.notifyDisplayHostSettled(1);

    expect(setViewport).toHaveBeenCalledWith(
      computeViewportForBoundsInVisibleCanvas({
        bounds: rect,
        canvas: { width: 960, height: 640 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
        leftOcclusion: 0,
      }),
    );
  });

  it('measures the current canvas size when resolving selection navigation', () => {
    let currentCanvasSize = { width: 960, height: 640 };
    const { manager, setViewport } = renderManager({
      getCurrentCanvasSize: () => currentCanvasSize,
    });
    const rect = { x: 920, y: 120, width: 180, height: 100 };

    manager.onCanvasInit({} as never);
    currentCanvasSize = { width: 640, height: 640 };
    const result = manager.requestNavigation({
      kind: 'ensure-visible',
      preset: 'selection',
      rect,
      duration: 0,
    });

    expect(result).toEqual({ status: 'queued', reason: 'motion-plan' });
    expect(setViewport).toHaveBeenCalledWith(
      computeViewportToKeepRectVisible({
        viewport: { x: 0, y: 0, zoom: 1 },
        canvas: { width: 640, height: 640 },
        rect,
        padding: 40,
        leftOcclusion: 0,
      }),
    );
  });

  it('reports selection navigation as unavailable when no usable canvas is mounted', () => {
    const { manager, setViewport } = renderManager({
      getCurrentCanvasSize: () => null,
    });

    manager.onCanvasInit({} as never);
    const result = manager.requestNavigation({
      kind: 'ensure-visible',
      preset: 'selection',
      rect: { x: 920, y: 120, width: 180, height: 100 },
      duration: 0,
    });

    expect(result).toEqual({ status: 'unavailable', reason: 'missing-canvas' });
    expect(setViewport).not.toHaveBeenCalled();
  });

  it('reports selection navigation as a noop when the selected rect is already visible', () => {
    const { manager, setViewport } = renderManager();

    manager.onCanvasInit({} as never);
    const result = manager.requestNavigation({
      kind: 'ensure-visible',
      preset: 'selection',
      rect: { x: 120, y: 120, width: 180, height: 100 },
      duration: 0,
    });

    expect(result).toEqual({ status: 'noop', reason: 'no-target' });
    expect(setViewport).not.toHaveBeenCalled();
  });

  it('reports navigation as a noop when the resolved target matches the current viewport', () => {
    const currentViewport = computeViewportForBoundsInVisibleCanvas({
      bounds: { x: 0, y: 0, width: 480, height: 320 },
      canvas: { width: 960, height: 640 },
      minZoom: 0.5,
      maxZoom: 2,
      padding: DEFAULT_VIEWPORT_FIT_PADDING,
      leftOcclusion: 0,
    });
    const { manager, setViewport } = renderManager({ initialViewport: currentViewport });

    manager.onCanvasInit({} as never);
    const result = manager.requestNavigation({
      kind: 'fit-scene',
      duration: 0,
    });

    expect(result).toEqual({ status: 'noop', reason: 'same-viewport' });
    expect(setViewport).not.toHaveBeenCalled();
  });

  it('interrupts managed motion for user gestures and persists only on gesture end', () => {
    const { manager, persistViewport } = renderManager();

    manager.onCanvasInit({} as never);
    manager.requestNavigation({
      kind: 'ensure-visible',
      preset: 'selection',
      rect: { x: 120, y: 120, width: 180, height: 100 },
    });

    expect(persistViewport).not.toHaveBeenCalled();

    manager.reportUserGestureStart();
    manager.reportUserGestureMove({ x: 24, y: -48, zoom: 0.82 });

    expect(persistViewport).not.toHaveBeenCalled();

    manager.reportUserGestureEnd({ x: 24, y: -48, zoom: 0.82 });

    expect(persistViewport).toHaveBeenCalledTimes(1);
    expect(persistViewport).toHaveBeenCalledWith({ x: 24, y: -48, zoom: 0.82 });
  });

  it('defers navigation requests that arrive during a user gesture until the gesture ends', () => {
    const { manager, setViewport } = renderManager();

    manager.onCanvasInit({} as never);
    manager.reportUserGestureStart();
    manager.requestNavigation({
      kind: 'ensure-visible',
      preset: 'selection',
      rect: { x: 920, y: 120, width: 180, height: 100 },
      duration: 0,
    });

    expect(setViewport).not.toHaveBeenCalled();

    manager.reportUserGestureEnd({ x: 0, y: 0, zoom: 1 });

    expect(setViewport).toHaveBeenCalledWith(
      computeViewportToKeepRectVisible({
        viewport: { x: 0, y: 0, zoom: 1 },
        canvas: { width: 960, height: 640 },
        rect: { x: 920, y: 120, width: 180, height: 100 },
        padding: 40,
        leftOcclusion: 0,
      }),
    );
  });

  it('defers structural choreography that arrives during a user gesture until the gesture ends', () => {
    const { manager } = renderManager();
    const startSnapshot = buildSnapshot();
    const endSnapshot = {
      ...buildSnapshot(),
      nodes: buildSnapshot().nodes.map((node) => ({
        ...node,
        rect: { ...node.rect, x: 100 },
      })),
    };
    const layout = buildLayout();

    manager.onCanvasInit({} as never);
    manager.reportUserGestureStart();
    manager.startChoreography({
      direction: 'in',
      focus: null,
      startLayout: layout,
      endLayout: layout,
      startSnapshot,
      endSnapshot,
      currentViewport: { x: 0, y: 0, zoom: 1 },
      endPointOfInterestNodeIds: [],
      collectSubtreeIds: () => new Set<string>(),
      planningAdvisory: {
        direction: 'in',
        structure: {
          rootIds: { from: 'root', to: 'root' },
          nodeDiffs: new Map(),
          childVisibilityDiffs: [],
          edgeDiffs: [],
        },
        geometry: {
          basePositions: {},
          targetPositions: {},
          nodeGeometry: new Map(),
        },
        sequence: {
          steps: [],
          nodeAdvisories: new Map(),
          childFadeAdvisories: new Map(),
          edgeAdvisories: new Map(),
          controlSwitchAdvisories: new Map(),
        },
      },
      persistFinalViewport: true,
    });

    expect(manager.getCurrentDisplaySnapshot().nodes[0]?.rect.x).toBe(0);

    manager.reportUserGestureEnd({ x: 0, y: 0, zoom: 1 });

    expect(manager.getCurrentDisplaySnapshot().nodes[0]?.rect.x).toBe(100);
  });
});
