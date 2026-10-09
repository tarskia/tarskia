import { indexTree } from '@tarskia/diagram-semantics';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutResult } from '../canvas/rendering/layout/layout-pipeline';
import {
  ANIMATION_CONSTANTS,
  DEFAULT_VIEWPORT_FIT_PADDING,
  FOCUS_SCOPE_CAMERA_PAUSE_MS,
} from '../canvas/rendering/transition/animation-constants';
import {
  computeViewportForBoundsInVisibleCanvas,
  computeViewportToKeepRectVisible,
} from '../canvas/viewport-visibility';
import {
  buildMotionPlanFromChoreographyRequest,
  buildRetainedOnlySnapshot,
  computePostOverlayBridgeViewport,
  computeStructuralCameraDurationMs,
  computeStructuralOverlayDurationMs,
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
  skipTransitions?: boolean;
  getCurrentCanvasSize?: () => { width: number; height: number } | null;
  initialViewport?: { x: number; y: number; zoom: number };
}) {
  const rawOnCanvasInit = vi.fn();
  const rawOnCanvasUnmount = vi.fn();
  let currentViewport = params?.initialViewport ?? { x: 0, y: 0, zoom: 1 };
  const getCurrentViewport = vi.fn(() => currentViewport);
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
      skipTransitions: params?.skipTransitions,
      savedCamera: undefined,
      getCurrentCanvasSize: params?.getCurrentCanvasSize ?? (() => ({ width: 960, height: 640 })),
      minZoom: 0.5,
      maxZoom: 2,
      persistViewport,
      onCanvasInit: rawOnCanvasInit,
      onCanvasUnmount: rawOnCanvasUnmount,
      getCurrentViewport,
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
    getSceneBounds,
    getNodeSetBounds,
    setViewport,
    persistViewport,
  };
}

describe('useDiagramMotionManager', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  let now = 0;
  let nextFrameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const finishFrames = () => {
    for (let step = 0; step < 30 && frames.size; step++) {
      now += 100;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    }
  };
  beforeEach(() => {
    now = 0;
    nextFrameId = 0;
    frames.clear();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
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

  it('applies reduced-motion camera navigation synchronously at the normal target', () => {
    const frame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', frame);
    const { manager, setViewport } = renderManager({ skipTransitions: true });
    manager.onCanvasInit({} as never);
    const result = manager.requestNavigation({ kind: 'fit-scene' });
    expect(result).toEqual({ status: 'applied', reason: 'synchronous' });
    expect(setViewport).toHaveBeenLastCalledWith(
      computeViewportForBoundsInVisibleCanvas({
        bounds: { x: 0, y: 0, width: 480, height: 320 },
        canvas: { width: 960, height: 640 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
    expect(frame).not.toHaveBeenCalled();
  });

  it('scales structural camera duration with viewport travel', () => {
    const baseDurationMs = ANIMATION_CONSTANTS.viewport.cameraDuration;

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
      },
      canvasSize: { width: 960, height: 640 },
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
      },
      canvasSize: { width: 960, height: 640 },
      minZoom: 0.1,
      maxZoom: 2,
    });

    const finalSegment = plan.segments[plan.segments.length - 1];

    expect(plan.segments[0]?.overlay?.incomingSnapshot).toBe(targetSnapshot);
    expect(finalSegment).toEqual({ durationMs: FOCUS_SCOPE_CAMERA_PAUSE_MS });
  });

  it('executes fit-scene navigation after canvas initialization', () => {
    const { manager, setViewport } = renderManager();

    manager.onCanvasInit({} as never);
    manager.requestNavigation({
      kind: 'fit-scene',
      preset: 'search-reveal',
    });

    expect(setViewport).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 1 });

    finishFrames();

    expect(setViewport).toHaveBeenCalledWith(
      computeViewportForBoundsInVisibleCanvas({
        bounds: { x: 0, y: 0, width: 480, height: 320 },
        canvas: { width: 960, height: 640 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
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

    expect(setViewport).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 1 });

    expect(setViewport).not.toHaveBeenLastCalledWith(
      computeViewportForBoundsInVisibleCanvas({
        bounds: currentBounds,
        canvas: { width: 960, height: 640 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
    now += 1000;
    for (const callback of queuedFrames.splice(0)) callback(now);

    expect(setViewport).toHaveBeenCalledWith(
      computeViewportForBoundsInVisibleCanvas({
        bounds: currentBounds,
        canvas: { width: 960, height: 640 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
  });

  it('fits the requested node bounds for focus navigation', () => {
    const { manager, setViewport } = renderManager();
    const rect = { x: 120, y: 80, width: 240, height: 180 };

    manager.onCanvasInit({} as never);
    manager.requestNavigation({
      kind: 'fit-node-set',
      nodeIds: ['node-1'],
      preset: 'focus',
    });

    expect(setViewport).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 1 });

    finishFrames();

    expect(setViewport).toHaveBeenCalledWith(
      computeViewportForBoundsInVisibleCanvas({
        bounds: rect,
        canvas: { width: 960, height: 640 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
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
    });

    expect(result).toEqual({ status: 'queued', reason: 'motion-plan' });
    finishFrames();
    expect(setViewport).toHaveBeenCalledWith(
      computeViewportToKeepRectVisible({
        viewport: { x: 0, y: 0, zoom: 1 },
        canvas: { width: 640, height: 640 },
        rect,
        padding: 40,
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
    });
    const { manager, setViewport } = renderManager({ initialViewport: currentViewport });

    manager.onCanvasInit({} as never);
    const result = manager.requestNavigation({
      kind: 'fit-scene',
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
    });

    expect(setViewport).not.toHaveBeenCalled();

    manager.reportUserGestureEnd({ x: 0, y: 0, zoom: 1 });
    finishFrames();

    expect(setViewport).toHaveBeenCalledWith(
      computeViewportToKeepRectVisible({
        viewport: { x: 0, y: 0, zoom: 1 },
        canvas: { width: 960, height: 640 },
        rect: { x: 920, y: 120, width: 180, height: 100 },
        padding: 40,
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
    });

    expect(manager.getCurrentDisplaySnapshot().nodes[0]?.rect.x).toBe(0);

    manager.reportUserGestureEnd({ x: 0, y: 0, zoom: 1 });
    finishFrames();

    expect(manager.getCurrentDisplaySnapshot().nodes[0]?.rect.x).toBe(100);
  });
});
