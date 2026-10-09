import type { SchemaModule, SemanticDocument } from '@tarskia/diagram-semantics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collectRectBounds } from '../canvas/focus-viewport';
import { buildStaticCanvasPresentation } from '../canvas/rendering/presentation/presentation';
import { useCanvasTransitionController } from '../canvas/useCanvasTransitionController';
import { useCanvasViewportAdapter } from '../canvas/useCanvasViewportAdapter';
import { useDiagramRenderingController } from '../canvas/useDiagramRenderingController';
import { type CanvasSize, measureCanvasElement } from './canvas-size';
import type { DiagramCameraRect, StructuralTransitionIntent } from './motion-types';
import { useCanvasBootstrapController } from './useCanvasBootstrapController';
import { useDiagramMotionManager } from './useDiagramMotionManager';

export interface UseDiagramEngineArgs {
  doc: SemanticDocument;
  schema: SchemaModule;
  skipTransitions: boolean;
  showDebug: boolean;
  persistViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  savedViewport?: { x: number; y: number; zoom: number };
  initialViewportKey?: string;
  minZoom: number;
  maxZoom: number;
}

export const resolveTransitionLiteMode = (hasTransitionOverlay: boolean) => hasTransitionOverlay;

export function useDiagramEngine({
  doc,
  schema,
  skipTransitions,
  showDebug,
  persistViewport,
  savedViewport,
  initialViewportKey,
  minZoom,
  maxZoom,
}: UseDiagramEngineArgs) {
  const viewportAdapter = useCanvasViewportAdapter();
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
  });

  const stableSnapshot = useMemo(
    () =>
      buildStaticCanvasPresentation({
        scene: rendering.layout,
        debug: showDebug,
      }),
    [rendering.layout, showDebug],
  );

  const motion = useDiagramMotionManager({
    initialViewportKey,
    stableSnapshot,
    skipTransitions,
    savedViewport,
    getCurrentCanvasSize,
    minZoom,
    maxZoom,
    persistViewport,
    onCanvasInit: viewportAdapter.onCanvasInit,
    onCanvasUnmount: viewportAdapter.onCanvasUnmount,
    getCurrentViewport: viewportAdapter.getCurrentViewport,
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
    setViewport: viewportAdapter.setViewport,
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

  const bootstrap = useCanvasBootstrapController({
    initialViewportKey,
    savedViewport,
    getCurrentCanvasSize,
    canvasLayoutVersion,
    sceneBounds: sceneBoundsRef.current,
    minZoom,
    maxZoom,
    canvasReady: motion.canvasReady,
    requestNavigation: motion.requestNavigation,
  });

  return {
    canvasRef,
    onCanvasElementChange,
    getCurrentCanvasSize,
    canvasLayoutVersion,
    onCanvasInit: motion.onCanvasInit,
    onCanvasUnmount: motion.onCanvasUnmount,
    getCurrentViewport: motion.getCurrentViewport,
    screenToWorldPosition: viewportAdapter.screenToWorldPosition,
    requestNavigation: motion.requestNavigation,
    reportUserGestureStart: motion.reportUserGestureStart,
    reportUserGestureMove: motion.reportUserGestureMove,
    reportUserGestureEnd: motion.reportUserGestureEnd,
    flushUserGesture: motion.flushUserGesture,
    notifyDisplayHostSettled: motion.notifyDisplayHostSettled,
    initialViewport: bootstrap.defaultViewport,
    setPendingStructuralTransitionIntent,
    graph: rendering.graph,
    compiled,
    presentation,
    transitionOverlay: motion.transitionOverlay,
    overlayFrameStore: motion.overlayFrameStore,
    hideHostVisuals: motion.hideHostVisuals,
    transitionLiteMode: resolveTransitionLiteMode(Boolean(motion.transitionOverlay)),
    isTransitionRunning: motion.motionPhase === 'animating',
    isTransitionQueued,
    motionPhase: motion.motionPhase,
    initialViewportPending: bootstrap.initialViewportPending,
    requiredHostGeneration: motion.requiredHostGeneration,
    cancelTransitions,
  };
}
