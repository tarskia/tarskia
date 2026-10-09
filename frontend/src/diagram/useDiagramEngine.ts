import type {
  DiagramCamera,
  DiagramView,
  SchemaModule,
  SemanticDocument,
  SemanticIndex,
} from '@tarskia/diagram-semantics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasCamera, CanvasPoint, CanvasViewport } from '../canvas/camera';
import { collectRectBounds } from '../canvas/focus-viewport';
import { buildStaticCanvasPresentation } from '../canvas/rendering/presentation/presentation';
import { useCanvasTransitionController } from '../canvas/useCanvasTransitionController';
import { useDiagramRenderingController } from '../canvas/useDiagramRenderingController';
import { captureDiagramCamera } from './camera-framing';
import { type CanvasSize, measureCanvasElement } from './canvas-size';
import type { DiagramCameraRect, StructuralTransitionIntent } from './motion-types';
import { useCanvasBootstrapController } from './useCanvasBootstrapController';
import { useDiagramMotionManager } from './useDiagramMotionManager';

export interface UseDiagramEngineArgs {
  doc?: SemanticDocument;
  index?: SemanticIndex;
  view?: DiagramView;
  schema?: SchemaModule;
  skipTransitions: boolean;
  showDebug: boolean;
  persistViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  savedCamera?: DiagramCamera;
  initialViewportKey?: string;
  minZoom: number;
  maxZoom: number;
}

export const resolveTransitionLiteMode = (hasTransitionFrame: boolean) => hasTransitionFrame;

export function useDiagramEngine({
  doc,
  schema,
  index,
  view,
  skipTransitions,
  showDebug,
  persistViewport,
  savedCamera,
  initialViewportKey,
  minZoom,
  maxZoom,
}: UseDiagramEngineArgs) {
  const cameraRef = useRef<CanvasCamera | null>(null);
  const onCameraInit = useCallback((camera: CanvasCamera) => {
    cameraRef.current = camera;
  }, []);
  const onCameraUnmount = useCallback(() => {
    cameraRef.current = null;
  }, []);
  const getCurrentViewport = useCallback(
    () => cameraRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 },
    [],
  );
  const setViewport = useCallback(
    (viewport: CanvasViewport) => cameraRef.current?.setViewport(viewport),
    [],
  );
  const screenToWorldPosition = useCallback(
    (point: CanvasPoint) => cameraRef.current?.screenToWorldPosition(point) ?? point,
    [],
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasResizeHandlerRef = useRef<(size: CanvasSize | null) => void>(() => {});
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(null);
  const [canvasLayoutVersion, setCanvasLayoutVersion] = useState(0);
  const sceneBoundsRef = useRef<DiagramCameraRect | null>(null);
  const nodeRectsByIdRef = useRef<Map<string, DiagramCameraRect>>(new Map());
  const pendingStructuralTransitionIntentRef = useRef<StructuralTransitionIntent | null>(null);
  const setPendingStructuralTransitionIntent = useCallback(
    (intent: StructuralTransitionIntent | null) => {
      pendingStructuralTransitionIntentRef.current = intent;
    },
    [],
  );

  const onCanvasElementChange = useCallback((element: HTMLDivElement | null) => {
    canvasRef.current = element;
    setCanvasElement(element);
  }, []);

  const getCurrentCanvasSize = useCallback(() => measureCanvasElement(canvasRef.current), []);

  useEffect(() => {
    if (!canvasElement) {
      return;
    }
    const element = canvasElement;
    const notifyLayoutChanged = () => {
      canvasResizeHandlerRef.current(measureCanvasElement(element));
      setCanvasLayoutVersion((current) => current + 1);
    };
    notifyLayoutChanged();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => notifyLayoutChanged());
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvasElement]);

  const rendering = useDiagramRenderingController({
    doc,
    schema,
    index,
    view,
  });

  const stableSnapshot = useMemo(
    () =>
      buildStaticCanvasPresentation({
        scene: rendering.layout,
        debug: showDebug,
      }),
    [rendering.layout, showDebug],
  );

  const getAnchorBounds = useCallback(
    (id: string) => stableSnapshot.nodes.find((node) => node.id === id)?.rect ?? null,
    [stableSnapshot],
  );
  const motion = useDiagramMotionManager({
    initialViewportKey,
    stableSnapshot,
    getAnchorBounds,
    skipTransitions,
    savedCamera,
    scopeRootId: view?.scopeRootId ?? doc?.view?.scopeRootId,
    getCurrentCanvasSize,
    minZoom,
    maxZoom,
    persistViewport,
    onCanvasInit: onCameraInit,
    onCanvasUnmount: onCameraUnmount,
    getCurrentViewport: getCurrentViewport,
    getSceneBounds: () => sceneBoundsRef.current,
    getNodeSetBounds: (nodeIds) => {
      const rects = nodeIds
        .map((nodeId) => nodeRectsByIdRef.current.get(nodeId))
        .filter((rect): rect is DiagramCameraRect => Boolean(rect));
      const bounds = collectRectBounds(rects);
      if (!bounds) {
        return null;
      }
      return {
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
      };
    },
    setViewport: setViewport,
  });

  canvasResizeHandlerRef.current = motion.notifyCanvasResize;

  const transitions = useCanvasTransitionController({
    layout: rendering.layout,
    stableSnapshot,
    declarativeViewState: rendering.declarativeViewState,
    buildTransitionAdvisory: rendering.buildTransitionAdvisory,
    resolveViewportFocusRoot: rendering.resolveViewportFocusRoot,
    viewportOps: rendering.viewport,
    skipTransitions,
    getCurrentViewport: motion.getCurrentViewport,
    getCurrentDisplaySnapshot: motion.getCurrentDisplaySnapshot,
    isMotionActive: motion.isMotionActive,
    requestNavigation: motion.requestNavigation,
    startChoreography: motion.startChoreography,
    cancelMotion: motion.cancelMotion,
    getPendingStructuralTransitionIntent: () => pendingStructuralTransitionIntentRef.current,
    clearPendingStructuralTransitionIntent: () => {
      pendingStructuralTransitionIntentRef.current = null;
    },
  });

  const { compiled, isTransitionQueued, cancelTransitions } = transitions;
  const presentation = useMemo(() => motion.hostSnapshot, [motion.hostSnapshot]);

  const { sceneBounds, nodeRectsById } = useMemo(() => {
    const cameraBoundsNodes = stableSnapshot.nodes.filter(
      (node) => !node.style.focusShell && node.opacity > 0.01,
    );
    const bounds = collectRectBounds(cameraBoundsNodes.map((node) => node.rect));
    return {
      sceneBounds: bounds
        ? {
            x: bounds.minX,
            y: bounds.minY,
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY,
          }
        : null,
      nodeRectsById: new Map(cameraBoundsNodes.map((node) => [node.id, node.rect])),
    };
  }, [stableSnapshot]);
  sceneBoundsRef.current = sceneBounds;
  nodeRectsByIdRef.current = nodeRectsById;

  const getSavedAnchorBounds = useCallback(
    (ids: string[]) => getAnchorBounds(ids[0]),
    [getAnchorBounds],
  );
  const bootstrap = useCanvasBootstrapController({
    getNodeSetBounds: getSavedAnchorBounds,
    initialViewportKey,
    savedCamera,
    scopeRootId: view?.scopeRootId ?? doc?.view?.scopeRootId,
    getCurrentCanvasSize,
    canvasLayoutVersion,
    sceneBounds: sceneBoundsRef.current,
    minZoom,
    maxZoom,
    canvasReady: motion.canvasReady,
    requestNavigation: motion.requestNavigation,
  });

  return {
    captureSavedCamera: () => {
      const canvasSize = getCurrentCanvasSize();
      return canvasSize
        ? captureDiagramCamera({
            viewport: motion.getCurrentViewport(),
            canvasSize,
            nodes: motion
              .getCurrentDisplaySnapshot()
              .nodes.filter((node) => node.opacity > 0.01)
              .map((node) => ({
                id: node.id,
                parentId: node.parentId,
                rect: node.rect,
              })),
            scopeRootId: view?.scopeRootId ?? doc?.view?.scopeRootId,
            scopeRootBounds: sceneBoundsRef.current,
          })
        : undefined;
    },
    canvasRef,
    onCanvasElementChange,
    getCurrentCanvasSize,
    canvasLayoutVersion,
    onCanvasInit: motion.onCanvasInit,
    onCanvasUnmount: motion.onCanvasUnmount,
    getCurrentViewport: motion.getCurrentViewport,
    screenToWorldPosition: screenToWorldPosition,
    requestNavigation: motion.requestNavigation,
    reportUserGestureStart: motion.reportUserGestureStart,
    reportUserGestureMove: motion.reportUserGestureMove,
    reportUserGestureEnd: motion.reportUserGestureEnd,
    flushUserGesture: motion.flushUserGesture,
    initialViewport: bootstrap.defaultViewport,
    setPendingStructuralTransitionIntent,
    graph: rendering.graph,
    compiled,
    presentation,
    transitionFrame: motion.transitionFrame,
    overlayFrameStore: motion.overlayFrameStore,
    isTransitionRunning: motion.motionPhase === 'animating',
    isTransitionQueued,
    motionPhase: motion.motionPhase,
    initialViewportPending: bootstrap.initialViewportPending,
    cancelTransitions,
  };
}
