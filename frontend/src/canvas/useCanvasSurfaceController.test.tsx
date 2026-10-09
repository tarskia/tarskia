import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NavigationIntent, NavigationRequestResult } from '../diagram/motion-types';
import type { UseCanvasSurfaceControllerArgs } from './useCanvasSurfaceController';
import {
  buildAutoVisibleSelectionKey,
  shouldCommitAutoVisibleSelectionKey,
  shouldHandleViewportGestureEvent,
} from './useCanvasSurfaceController';

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
        presentation: params?.presentation ?? {
          nodes: [],
          overlayEdges: [],
        },
        compiled: {
          visibleIds: new Set<string>((params?.presentation?.nodes ?? []).map((node) => node.id)),
        } as never,
        transitionFrame: null,
        overlayFrameStore: null,
        transitionLiteMode: params?.transitionLiteMode ?? false,
        isTransitionRunning: false,
        isTransitionQueued: false,
        motionPhase: 'idle',
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

  it('preserves semantic node controls on the stable presentation', async () => {
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
    expect(runtimeControls?.disableControlActions).toBe(false);
    expect(runtimeControls?.hideLocalEdgeLabels).toBe(false);
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
