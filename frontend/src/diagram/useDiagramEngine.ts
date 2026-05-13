import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { collectRectBounds } from '../canvas/focus-viewport';
import { buildStaticCanvasPresentation } from '../canvas/rendering/presentation/presentation';
import type { AnimationSettings } from '../canvas/rendering/transition/animation-constants';
import { useCanvasTransitionController } from '../canvas/useCanvasTransitionController';
import { useCanvasViewportAdapter } from '../canvas/useCanvasViewportAdapter';
import { useDiagramRenderingController } from '../canvas/useDiagramRenderingController';
import type { SchemaModule, SemanticDocument } from '../semantic';
import type {
  DiagramCameraPolicy,
  DiagramCameraRect,
  StructuralTransitionIntent,
} from './motion-types';
import { useCanvasBootstrapController } from './useCanvasBootstrapController';
import { useDiagramMotionManager } from './useDiagramMotionManager';

export interface UseDiagramEngineArgs {
  doc: SemanticDocument;
  schema: SchemaModule;
  animationSettings: AnimationSettings;
  skipTransitions: boolean;
  showDebug: boolean;
  persistViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  traceSelection: (event: string, payload?: Record<string, unknown>) => void;
  savedViewport?: { x: number; y: number; zoom: number };
  initialViewportKey?: string;
  cameraPolicy?: DiagramCameraPolicy;
  leftOcclusion?: number;
  minZoom: number;
  maxZoom: number;
}

export const resolveTransitionLiteMode = (hasTransitionOverlay: boolean) => hasTransitionOverlay;

export function useDiagramEngine({
  doc,
  schema,
  animationSettings,
  skipTransitions,
  showDebug,
  persistViewport,
  traceSelection,
  savedViewport,
  initialViewportKey,
  cameraPolicy,
  leftOcclusion,
  minZoom,
  maxZoom,
}: UseDiagramEngineArgs) {
  const viewportAdapter = useCanvasViewportAdapter();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
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

  useEffect(() => {
    if (!canvasElement) {
      setCanvasSize(null);
      return;
    }
    const element = canvasElement;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvasElement]);

  const rendering = useDiagramRenderingController({
    doc,
    schema,
    canvasSize,
  });

  const stableSnapshot = useMemo(
    () =>
      buildStaticCanvasPresentation({
        scene: rendering.layout,
        debug: showDebug,
      }),
    [rendering.layout, showDebug],
  );

  const getEffectiveLeftOcclusion = useCallback(
    () => leftOcclusion ?? viewportAdapter.getLeftOcclusion(),
    [leftOcclusion, viewportAdapter],
  );

  const motion = useDiagramMotionManager({
    stableSnapshot,
    animationSettings,
    savedViewport,
    cameraPolicy,
    canvasSize,
    minZoom,
    maxZoom,
    persistViewport,
    onCanvasInit: viewportAdapter.onCanvasInit,
    onCanvasUnmount: viewportAdapter.onCanvasUnmount,
    getCurrentViewport: viewportAdapter.getCurrentViewport,
    getLeftOcclusion: getEffectiveLeftOcclusion,
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

  const transitions = useCanvasTransitionController({
    layout: rendering.layout,
    stableSnapshot,
    declarativeViewState: rendering.declarativeViewState,
    buildTransitionAdvisory: rendering.buildTransitionAdvisory,
    resolveViewportFocusRoot: rendering.resolveViewportFocusRoot,
    viewportOps: rendering.viewport,
    animationSettings,
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
    traceSelection,
  });

  const { compiled, isTransitionQueued, cancelTransitions } = transitions;
  const presentation = useMemo(() => motion.hostSnapshot, [motion.hostSnapshot]);

  const cameraBoundsNodes = stableSnapshot.nodes.filter(
    (node) => !node.style.focusShell && node.opacity > 0.01,
  );
  const sceneBounds = collectRectBounds(cameraBoundsNodes.map((node) => node.rect));
  sceneBoundsRef.current = sceneBounds
    ? {
        x: sceneBounds.minX,
        y: sceneBounds.minY,
        width: sceneBounds.maxX - sceneBounds.minX,
        height: sceneBounds.maxY - sceneBounds.minY,
      }
    : null;
  nodeRectsByIdRef.current = new Map(cameraBoundsNodes.map((node) => [node.id, node.rect]));

  const bootstrap = useCanvasBootstrapController({
    initialViewportKey,
    savedViewport,
    canvasSize,
    sceneBounds: sceneBoundsRef.current,
    minZoom,
    maxZoom,
    animationSettings,
    cameraPolicy,
    getLeftOcclusion: getEffectiveLeftOcclusion,
    canvasReady: motion.canvasReady,
    requestNavigation: motion.requestNavigation,
  });

  return {
    canvasRef,
    onCanvasElementChange,
    canvasSize,
    onCanvasInit: motion.onCanvasInit,
    onCanvasUnmount: motion.onCanvasUnmount,
    setLeftOcclusion: viewportAdapter.setLeftOcclusion,
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
    sceneQueries: rendering.sceneQueries,
    compiled,
    presentation,
    transitionOverlay: motion.transitionOverlay,
    transitionOverlayFrame: motion.transitionOverlayFrame,
    hideHostVisuals: motion.hideHostVisuals,
    transitionLiteMode: resolveTransitionLiteMode(Boolean(motion.transitionOverlay)),
    isTransitionRunning: motion.motionPhase === 'animating',
    isTransitionQueued,
    motionPhase: motion.motionPhase,
    initialViewportPending: bootstrap.initialViewportPending,
    requiredHostGeneration: motion.requiredHostGeneration,
    frameDurations: motion.frameDurations,
    cancelTransitions,
  };
}
