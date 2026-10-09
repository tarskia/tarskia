import type { DiagramCamera, ViewportState } from '@tarskia/diagram-semantics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasCamera } from '../canvas/camera';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
import {
  ANIMATION_CONSTANTS,
  DEFAULT_VIEWPORT_FIT_PADDING,
} from '../canvas/rendering/transition/animation-constants';
import { buildStructuralCameraAdvisory } from '../canvas/rendering/transition/camera';
import {
  buildStaticTransitionFrameState,
  captureTransitionFrameSnapshot,
  resolveAnimationFrame,
  type TransitionFrameState,
} from '../canvas/rendering/transition/overlay';
import { createOverlayFrameStore } from '../canvas/rendering/transition/overlay-frame-store';
import {
  buildTimedTransitionPlan,
  buildTimedTransitionSequence,
} from '../canvas/rendering/transition/timed-plan';
import {
  advanceManagedTransitionState,
  createTransitionFrameManagerState,
  startManagedTransitionState,
  syncTransitionFrameManagerStableSnapshot,
  type TransitionFrameManagerState,
} from '../canvas/useTransitionFrameManager';
import { computeViewportForBoundsInVisibleCanvas } from '../canvas/viewport-visibility';
import { interpolateCameraViewport } from './camera-interpolation';
import {
  type ResolvedNavigationPolicy,
  resolveNavigationPolicy,
  resolveNavigationViewport,
  viewportStatesEqual,
} from './camera-navigation';
import type { CanvasSize, GetCurrentCanvasSize } from './canvas-size';
import type {
  DiagramCameraRect,
  MotionCallbacks,
  MotionPhase,
  MotionPlan,
  MotionSegment,
  MotionSettlementReason,
  NavigationIntent,
  NavigationRequestResult,
  StructuralChoreographyRequest,
} from './motion-types';

const MIN_STRUCTURAL_OVERLAY_DURATION_MS = 320;
const MAX_STRUCTURAL_CAMERA_DURATION_SCALE = 1.85;

interface ActiveMotion {
  plan: MotionPlan;
  activeSegmentIndex: number;
  segmentStartedAt: number | null;
  segmentSourceViewport: ViewportState | null;
  settle: (reason: MotionSettlementReason) => void;
}

interface PendingManagedMotion {
  plan: MotionPlan;
  settle: (reason: MotionSettlementReason) => void;
}

interface DiagramMotionRenderState {
  hostSnapshot: CanvasRenderSnapshot;
  transitionFrame: TransitionFrameState | null;
  motionPhase: MotionPhase;
}

interface UseDiagramMotionManagerArgs {
  stableSnapshot: CanvasRenderSnapshot;
  skipTransitions?: boolean;
  initialViewportKey?: string;
  savedCamera?: DiagramCamera;
  getAnchorBounds?: (id: string) => DiagramCameraRect | null;
  scopeRootId?: string;
  getCurrentCanvasSize: GetCurrentCanvasSize;
  minZoom: number;
  maxZoom: number;
  persistViewport: (viewport: ViewportState) => void;
  onCanvasInit: (instance: CanvasCamera) => void;
  onCanvasUnmount: () => void;
  getCurrentViewport: () => ViewportState;
  getSceneBounds: () => DiagramCameraRect | null;
  getNodeSetBounds: (nodeIds: string[]) => DiagramCameraRect | null;
  setViewport: (viewport: ViewportState) => void;
}

const createMotionSettlement = (callbacks?: MotionCallbacks) => {
  let settled = false;
  return (reason: MotionSettlementReason) => {
    if (settled) return;
    settled = true;
    try {
      if (reason === 'completed') callbacks?.onComplete?.();
    } finally {
      callbacks?.onSettled?.(reason);
    }
  };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const easeStructuralCamera = (value: number) => -(Math.cos(Math.PI * value) - 1) / 2;

type SnapshotBounds = { minX: number; minY: number; maxX: number; maxY: number };

const unionSnapshotBounds = (left: SnapshotBounds, right: SnapshotBounds): SnapshotBounds => ({
  minX: Math.min(left.minX, right.minX),
  minY: Math.min(left.minY, right.minY),
  maxX: Math.max(left.maxX, right.maxX),
  maxY: Math.max(left.maxY, right.maxY),
});

const collectSnapshotNodeBounds = (
  snapshot: CanvasRenderSnapshot,
  nodeIds: string[],
): SnapshotBounds | null => {
  const requestedIds = new Set(nodeIds);
  let bounds: SnapshotBounds | null = null;
  for (const node of snapshot.nodes) {
    if (!requestedIds.has(node.id) || node.opacity <= 0.001) {
      continue;
    }
    const nodeBounds = {
      minX: node.rect.x,
      minY: node.rect.y,
      maxX: node.rect.x + node.rect.width,
      maxY: node.rect.y + node.rect.height,
    };
    bounds = bounds ? unionSnapshotBounds(bounds, nodeBounds) : nodeBounds;
  }
  return bounds;
};

const boundsWidth = (bounds: SnapshotBounds) => Math.max(1, bounds.maxX - bounds.minX);
const boundsHeight = (bounds: SnapshotBounds) => Math.max(1, bounds.maxY - bounds.minY);

const snapshotBoundsToRect = (bounds: SnapshotBounds): DiagramCameraRect => ({
  x: bounds.minX,
  y: bounds.minY,
  width: boundsWidth(bounds),
  height: boundsHeight(bounds),
});

const collectSnapshotSceneBounds = (snapshot: CanvasRenderSnapshot): SnapshotBounds | null => {
  let bounds: SnapshotBounds | null = null;
  for (const node of snapshot.nodes) {
    if (node.style.focusShell || node.opacity <= 0.001) {
      continue;
    }
    const nodeBounds = {
      minX: node.rect.x,
      minY: node.rect.y,
      maxX: node.rect.x + node.rect.width,
      maxY: node.rect.y + node.rect.height,
    };
    bounds = bounds ? unionSnapshotBounds(bounds, nodeBounds) : nodeBounds;
  }
  return bounds;
};

export const buildRetainedOnlySnapshot = (
  snapshot: CanvasRenderSnapshot,
  nodeIds: string[],
): CanvasRenderSnapshot => {
  const retainedIds = new Set(nodeIds);
  return {
    nodes: snapshot.nodes.filter((node) => retainedIds.has(node.id)),
    overlayEdges: snapshot.overlayEdges.filter(
      (edge) => retainedIds.has(edge.sourceId) && retainedIds.has(edge.targetId),
    ),
  };
};

export const computePostOverlayBridgeViewport = (params: {
  sourceSnapshot: CanvasRenderSnapshot;
  targetSnapshot: CanvasRenderSnapshot;
  nodeIds: string[];
  currentViewport: ViewportState;
  minZoom: number;
  maxZoom: number;
}): ViewportState | null => {
  const { sourceSnapshot, targetSnapshot, nodeIds, currentViewport, minZoom, maxZoom } = params;
  if (nodeIds.length === 0) {
    return null;
  }
  const sourceBounds = collectSnapshotNodeBounds(sourceSnapshot, nodeIds);
  const targetBounds = collectSnapshotNodeBounds(targetSnapshot, nodeIds);
  if (!sourceBounds || !targetBounds) {
    return null;
  }
  const sourceScreenWidth = boundsWidth(sourceBounds) * currentViewport.zoom;
  const sourceScreenHeight = boundsHeight(sourceBounds) * currentViewport.zoom;
  const nextZoom = clamp(
    Math.min(
      sourceScreenWidth / boundsWidth(targetBounds),
      sourceScreenHeight / boundsHeight(targetBounds),
    ),
    minZoom,
    maxZoom,
  );
  const sourceScreenCenterX =
    currentViewport.x + ((sourceBounds.minX + sourceBounds.maxX) / 2) * currentViewport.zoom;
  const sourceScreenCenterY =
    currentViewport.y + ((sourceBounds.minY + sourceBounds.maxY) / 2) * currentViewport.zoom;
  const targetCenterX = (targetBounds.minX + targetBounds.maxX) / 2;
  const targetCenterY = (targetBounds.minY + targetBounds.maxY) / 2;
  return {
    x: sourceScreenCenterX - targetCenterX * nextZoom,
    y: sourceScreenCenterY - targetCenterY * nextZoom,
    zoom: nextZoom,
  };
};

const computeSnapshotSceneFitViewport = (params: {
  snapshot: CanvasRenderSnapshot;
  canvasSize: CanvasSize | null;
  minZoom: number;
  maxZoom: number;
}): ViewportState | null => {
  const { snapshot, canvasSize, minZoom, maxZoom } = params;
  if (!canvasSize) {
    return null;
  }
  const sceneBounds = collectSnapshotSceneBounds(snapshot);
  if (!sceneBounds) {
    return null;
  }
  return computeViewportForBoundsInVisibleCanvas({
    bounds: snapshotBoundsToRect(sceneBounds),
    canvas: canvasSize,
    minZoom,
    maxZoom,
    padding: DEFAULT_VIEWPORT_FIT_PADDING,
  });
};

const captureDisplayedSnapshot = (
  overlayState: TransitionFrameManagerState,
  now: number,
): CanvasRenderSnapshot => {
  if (!overlayState.transitionFrame) {
    return overlayState.hostSnapshot;
  }
  return captureTransitionFrameSnapshot({
    state: overlayState.transitionFrame,
    frame: resolveAnimationFrame(overlayState.transitionFrame, now),
  });
};

const freezeOverlayToSnapshot = (params: {
  previous: TransitionFrameManagerState;
  snapshot: CanvasRenderSnapshot;
  now: number;
}): TransitionFrameManagerState => ({
  ...createTransitionFrameManagerState(params.snapshot),
  transitionFrame: buildStaticTransitionFrameState({
    snapshot: params.snapshot,
    id: params.now,
    startedAt: params.now,
  }),
});

const getSegmentCameraTarget = (segment: MotionSegment) => segment.camera?.to ?? null;

const pushPauseSegment = (segments: MotionSegment[], durationMs: number | undefined) => {
  const resolvedDurationMs = Math.max(0, durationMs ?? 0);
  if (resolvedDurationMs <= 0) {
    return;
  }
  segments.push({ durationMs: resolvedDurationMs });
};

const isTimedPauseSegment = (segment: MotionSegment) =>
  segment.durationMs > 0 && !segment.camera && !segment.overlay;

export const computeStructuralCameraDurationMs = (params: {
  from: ViewportState;
  to: ViewportState;
  baseDurationMs: number;
  canvasSize: CanvasSize | null;
}) => {
  const { from, to, baseDurationMs, canvasSize } = params;
  if (baseDurationMs <= 0 || !canvasSize) {
    return Math.max(0, baseDurationMs);
  }

  const normalizedDx = Math.abs(to.x - from.x) / Math.max(canvasSize.width, 1);
  const normalizedDy = Math.abs(to.y - from.y) / Math.max(canvasSize.height, 1);
  const translationScore = Math.hypot(normalizedDx, normalizedDy);
  const zoomScore = Math.abs(Math.log(Math.max(to.zoom, 0.001) / Math.max(from.zoom, 0.001)));
  const scale = clamp(
    1 + translationScore * 0.45 + zoomScore * 0.7,
    1,
    MAX_STRUCTURAL_CAMERA_DURATION_SCALE,
  );
  return Math.round(baseDurationMs * scale);
};

export const computeStructuralOverlayDurationMs = (params: {
  baseOverlayDurationMs: number;
  choreographyCameraDurationMs: number;
  hasStructuredPhases: boolean;
}) => {
  const { baseOverlayDurationMs, choreographyCameraDurationMs, hasStructuredPhases } = params;
  if (!hasStructuredPhases) {
    return Math.round(baseOverlayDurationMs);
  }
  return Math.max(
    Math.round(baseOverlayDurationMs),
    MIN_STRUCTURAL_OVERLAY_DURATION_MS,
    Math.round(choreographyCameraDurationMs * 0.95),
  );
};

export const buildMotionPlanFromChoreographyRequest = (params: {
  request: StructuralChoreographyRequest;
  canvasSize: CanvasSize | null;
  minZoom: number;
  maxZoom: number;
}): MotionPlan => {
  const { request, canvasSize, minZoom, maxZoom } = params;
  const timedSequence = buildTimedTransitionSequence({
    planningAdvisory: request.planningAdvisory,
  });
  const timedPlan = buildTimedTransitionPlan({
    planningAdvisory: request.planningAdvisory,
    timedSequence,
  });
  const cameraAdvisory = buildStructuralCameraAdvisory({
    direction: request.direction,
    focus: request.focus,
    startLayout: request.startLayout,
    endLayout: request.endLayout,
    currentViewport: request.currentViewport,
    canvasSize,
    endPointOfInterestNodeIds: request.endPointOfInterestNodeIds,
    collectSubtreeIds: request.collectSubtreeIds,
    padding: ANIMATION_CONSTANTS.viewport.padding,
    minZoom,
    maxZoom,
  });

  const cameraDurationMs = Math.max(0, ANIMATION_CONSTANTS.viewport.cameraDuration);
  const segments: MotionSegment[] = [];
  let viewportCursor = request.currentViewport;
  let preludeCameraDurationMs = cameraDurationMs;

  if (request.direction === 'in' && request.exitScopeRetainedNodeIds?.length) {
    const retainedSnapshot = buildRetainedOnlySnapshot(
      request.endSnapshot,
      request.exitScopeRetainedNodeIds,
    );
    const bridgeViewport = computePostOverlayBridgeViewport({
      sourceSnapshot: request.startSnapshot,
      targetSnapshot: request.endSnapshot,
      nodeIds: request.exitScopeRetainedNodeIds,
      currentViewport: viewportCursor,
      minZoom,
      maxZoom,
    });
    const sceneFitViewport = computeSnapshotSceneFitViewport({
      snapshot: request.endSnapshot,
      canvasSize,
      minZoom,
      maxZoom,
    });

    if (retainedSnapshot.nodes.length > 0 && sceneFitViewport) {
      const retainedViewport = bridgeViewport ?? viewportCursor;
      segments.push({
        durationMs: 0,
        camera: bridgeViewport
          ? {
              from: viewportCursor,
              to: bridgeViewport,
            }
          : undefined,
        hostSnapshot: retainedSnapshot,
      });
      viewportCursor = retainedViewport;

      if (!viewportStatesEqual(viewportCursor, sceneFitViewport)) {
        segments.push({
          durationMs: Math.max(0, ANIMATION_CONSTANTS.viewport.fitDuration),
          camera: {
            from: viewportCursor,
            to: sceneFitViewport,
          },
        });
        viewportCursor = sceneFitViewport;
      }

      pushPauseSegment(segments, request.pauseBeforeOverlayMs);

      segments.push({
        durationMs: computeStructuralOverlayDurationMs({
          baseOverlayDurationMs: timedPlan.totalDuration,
          choreographyCameraDurationMs: Math.max(0, ANIMATION_CONSTANTS.viewport.fitDuration),
          hasStructuredPhases: request.planningAdvisory.sequence.steps.length > 0,
        }),
        overlay: {
          incomingSnapshot: request.endSnapshot,
          planningAdvisory: request.planningAdvisory,
          timedPlan,
          timedSequence,
        },
      });

      return {
        segments,
        sourceSnapshot: request.startSnapshot,
        targetSnapshot: request.endSnapshot,
      };
    }
  }

  if (cameraAdvisory.prelude && !viewportStatesEqual(viewportCursor, cameraAdvisory.prelude)) {
    preludeCameraDurationMs = computeStructuralCameraDurationMs({
      from: viewportCursor,
      to: cameraAdvisory.prelude,
      baseDurationMs: cameraDurationMs,
      canvasSize,
    });
    segments.push({
      durationMs: preludeCameraDurationMs,
      camera: {
        from: viewportCursor,
        to: cameraAdvisory.prelude,
      },
    });
    viewportCursor = cameraAdvisory.prelude;
  }

  pushPauseSegment(segments, request.pauseBeforeOverlayMs);

  segments.push({
    durationMs: computeStructuralOverlayDurationMs({
      baseOverlayDurationMs: timedPlan.totalDuration,
      choreographyCameraDurationMs: preludeCameraDurationMs,
      hasStructuredPhases: request.planningAdvisory.sequence.steps.length > 0,
    }),
    overlay: {
      incomingSnapshot: request.endSnapshot,
      planningAdvisory: request.planningAdvisory,
      timedPlan,
      timedSequence,
      sharedNodeGeometry: request.sharedNodeGeometry,
    },
  });

  if (request.postOverlayViewportBridgeNodeIds?.length) {
    const bridgeViewport = computePostOverlayBridgeViewport({
      sourceSnapshot: request.startSnapshot,
      targetSnapshot: request.endSnapshot,
      nodeIds: request.postOverlayViewportBridgeNodeIds,
      currentViewport: viewportCursor,
      minZoom,
      maxZoom,
    });
    if (bridgeViewport && !viewportStatesEqual(viewportCursor, bridgeViewport)) {
      segments.push({
        durationMs: 0,
        camera: {
          from: viewportCursor,
          to: bridgeViewport,
        },
      });
      viewportCursor = bridgeViewport;
    }
  }

  pushPauseSegment(segments, request.pauseAfterOverlayMs);

  if (cameraAdvisory.epilogue && !viewportStatesEqual(viewportCursor, cameraAdvisory.epilogue)) {
    const epilogueCameraDurationMs = computeStructuralCameraDurationMs({
      from: viewportCursor,
      to: cameraAdvisory.epilogue,
      baseDurationMs: cameraDurationMs,
      canvasSize,
    });
    segments.push({
      durationMs: epilogueCameraDurationMs,
      camera: {
        from: viewportCursor,
        to: cameraAdvisory.epilogue,
      },
    });
  }

  return {
    segments,
    sourceSnapshot: request.startSnapshot,
    targetSnapshot: request.endSnapshot,
  };
};

export function useDiagramMotionManager({
  stableSnapshot,
  skipTransitions = false,
  initialViewportKey,
  savedCamera,
  getAnchorBounds,
  scopeRootId,
  getCurrentCanvasSize,
  minZoom,
  maxZoom,
  persistViewport,
  onCanvasInit: onCanvasInitRaw,
  onCanvasUnmount: onCanvasUnmountRaw,
  getCurrentViewport,
  getSceneBounds,
  getNodeSetBounds,
  setViewport,
}: UseDiagramMotionManagerArgs) {
  const [renderState, setRenderState] = useState<DiagramMotionRenderState>(() => ({
    hostSnapshot: stableSnapshot,
    transitionFrame: null,
    motionPhase: 'idle',
  }));
  const renderStateRef = useRef(renderState);
  const [overlayFrameStore] = useState(createOverlayFrameStore);
  const overlayStateRef = useRef(createTransitionFrameManagerState(stableSnapshot));
  const stableSnapshotRef = useRef(stableSnapshot);
  const skipTransitionsRef = useRef(skipTransitions);
  skipTransitionsRef.current = skipTransitions;
  const activeMotionRef = useRef<ActiveMotion | null>(null);
  const pendingManagedMotionRef = useRef<PendingManagedMotion | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const canvasReadyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const motionPhaseRef = useRef<MotionPhase>('idle');
  const userGestureActiveRef = useRef(false);
  const motionRequestVersionRef = useRef(0);
  const deferredNavigationFrameRef = useRef<number | null>(null);
  const deferredNavigationSettlementRef = useRef<((reason: MotionSettlementReason) => void) | null>(
    null,
  );
  const currentViewportRef = useRef<ViewportState>(getCurrentViewport());
  const previousCanvasSizeRef = useRef<CanvasSize | null>(null);
  const automaticFramingRef = useRef<NavigationIntent | null>(null);

  stableSnapshotRef.current = stableSnapshot;

  const cancelScheduledFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cancelDeferredNavigationFrame = useCallback(
    (reason: MotionSettlementReason = 'cancelled', notify = true) => {
      if (deferredNavigationFrameRef.current !== null) {
        cancelAnimationFrame(deferredNavigationFrameRef.current);
        deferredNavigationFrameRef.current = null;
      }
      const settle = deferredNavigationSettlementRef.current;
      deferredNavigationSettlementRef.current = null;
      if (notify) settle?.(reason);
      return settle;
    },
    [],
  );

  const persistNow = useCallback(
    (viewport: ViewportState) => {
      currentViewportRef.current = viewport;
      persistViewport(viewport);
    },
    [persistViewport],
  );

  const getObservedViewport = useCallback((): ViewportState => currentViewportRef.current, []);

  const applyViewport = useCallback(
    (viewport: ViewportState) => {
      currentViewportRef.current = viewport;
      setViewport(viewport);
    },
    [setViewport],
  );

  const publish = useCallback(
    (_now: number) => {
      const overlayState = overlayStateRef.current;
      const nextTransitionFrame = overlayState.transitionFrame;
      const nextAnimationFrame = nextTransitionFrame
        ? resolveAnimationFrame(nextTransitionFrame, _now)
        : null;
      const transitionFrame = nextTransitionFrame;
      const animationFrame = nextAnimationFrame;
      const previous = renderStateRef.current;
      const next = {
        hostSnapshot: overlayState.hostSnapshot,
        transitionFrame,
        motionPhase: motionPhaseRef.current,
      } satisfies DiagramMotionRenderState;
      if (
        previous.hostSnapshot !== next.hostSnapshot ||
        previous.transitionFrame !== next.transitionFrame ||
        previous.motionPhase !== next.motionPhase
      ) {
        renderStateRef.current = next;
        setRenderState(next);
      }
      overlayFrameStore.publish(animationFrame);
    },
    [overlayFrameStore],
  );

  const scheduleNextFrame = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame((now) => {
      rafRef.current = null;
      stepRef.current(now);
    });
  }, []);

  const finishMotion = useCallback(
    (now: number) => {
      const activeMotion = activeMotionRef.current;
      activeMotionRef.current = null;
      overlayStateRef.current = createTransitionFrameManagerState(
        activeMotion?.plan.targetSnapshot ?? stableSnapshotRef.current,
      );
      motionPhaseRef.current = 'idle';

      publish(now);
      activeMotion?.settle('completed');
    },
    [publish],
  );

  const enterSegmentRef = useRef<(segmentIndex: number, now: number) => void>(() => {});
  const stepRef = useRef<(now: number) => void>(() => {});

  enterSegmentRef.current = (segmentIndex: number, now: number) => {
    const activeMotion = activeMotionRef.current;
    if (!activeMotion) {
      finishMotion(now);
      return;
    }
    const segment = activeMotion.plan.segments[segmentIndex];
    if (!segment) {
      finishMotion(now);
      return;
    }

    let overlayState = overlayStateRef.current;
    const segmentStartedAt: number | null = now;

    if (segment.hostSnapshot) {
      const displaySnapshot = captureDisplayedSnapshot(overlayState, now);
      overlayState = freezeOverlayToSnapshot({
        previous: overlayState,
        snapshot: displaySnapshot,
        now,
      });
    } else if (segment.overlay) {
      overlayState = startManagedTransitionState(overlayState, {
        incomingSnapshot: segment.overlay.incomingSnapshot,
        planningAdvisory: segment.overlay.planningAdvisory,
        timedPlan: segment.overlay.timedPlan,
        timedSequence: segment.overlay.timedSequence,
        duration: Math.max(1, segment.durationMs),
        sharedNodeGeometry: segment.overlay.sharedNodeGeometry,
        now,
      });
    }

    overlayStateRef.current = overlayState;
    const cameraStartViewport = segment.camera?.from ?? getObservedViewport();

    activeMotionRef.current = {
      ...activeMotion,
      activeSegmentIndex: segmentIndex,
      segmentStartedAt,
      segmentSourceViewport: segmentStartedAt !== null ? cameraStartViewport : null,
    };

    if (segmentStartedAt !== null) {
      const cameraTarget = getSegmentCameraTarget(segment);
      if (cameraTarget) {
        applyViewport(segment.durationMs <= 0 ? cameraTarget : cameraStartViewport);
      }
    }

    if (segmentStartedAt === null) {
      motionPhaseRef.current = userGestureActiveRef.current ? 'userGesture' : 'settling';
      publish(now);
      return;
    }

    const hasAnimatedCamera = Boolean(segment.camera && segment.durationMs > 0);
    const hasAnimatedOverlay = Boolean(segment.overlay);
    const hasTimedPause = isTimedPauseSegment(segment);
    motionPhaseRef.current = userGestureActiveRef.current ? 'userGesture' : 'animating';
    publish(now);

    if (segment.durationMs <= 0 && !hasAnimatedOverlay) {
      const cameraTarget = getSegmentCameraTarget(segment);
      if (cameraTarget) {
        applyViewport(cameraTarget);
      }
      enterSegmentRef.current(segmentIndex + 1, now);
      return;
    }

    if (hasAnimatedCamera || hasAnimatedOverlay || hasTimedPause) {
      scheduleNextFrame();
      return;
    }

    enterSegmentRef.current(segmentIndex + 1, now);
  };

  stepRef.current = (now: number) => {
    const activeMotion = activeMotionRef.current;
    if (!activeMotion) {
      publish(now);
      return;
    }
    const segment = activeMotion.plan.segments[activeMotion.activeSegmentIndex];
    if (!segment || activeMotion.segmentStartedAt === null) {
      publish(now);
      return;
    }

    if (segment.overlay) {
      const advanced = advanceManagedTransitionState(overlayStateRef.current, now);
      overlayStateRef.current = advanced.state;
    }

    let cameraDone = !segment.camera;
    if (segment.camera) {
      const sourceViewport = activeMotion.segmentSourceViewport ?? getObservedViewport();
      const rawProgress =
        segment.durationMs <= 0
          ? 1
          : clamp((now - activeMotion.segmentStartedAt) / segment.durationMs, 0, 1);
      const eased = easeStructuralCamera(rawProgress);
      const currentViewport = interpolateCameraViewport({
        from: sourceViewport,
        to: segment.camera.to,
        progress: eased,
        canvas: getCurrentCanvasSize() ?? { width: 0, height: 0 },
        minZoom,
        maxZoom,
      });
      applyViewport(currentViewport);
      cameraDone = rawProgress >= 1;
    }
    const pauseDone =
      !isTimedPauseSegment(segment) ||
      now - activeMotion.segmentStartedAt >= Math.max(0, segment.durationMs);

    const overlayState = overlayStateRef.current;
    const overlayDone =
      !segment.overlay || (overlayState.transitionFrame === null && overlayState.phase === 'idle');
    const overlayWaiting = Boolean(segment.overlay && overlayState.phase === 'settling');
    const overlayAnimating = Boolean(segment.overlay && overlayState.phase === 'animating');

    if (overlayWaiting) {
      motionPhaseRef.current = userGestureActiveRef.current ? 'userGesture' : 'settling';
      publish(now);
      return;
    }

    if (overlayAnimating || !cameraDone || !pauseDone) {
      motionPhaseRef.current = userGestureActiveRef.current ? 'userGesture' : 'animating';
      publish(now);
      scheduleNextFrame();
      return;
    }

    if (!overlayDone) {
      motionPhaseRef.current = userGestureActiveRef.current ? 'userGesture' : 'settling';
      publish(now);
      return;
    }

    enterSegmentRef.current(activeMotion.activeSegmentIndex + 1, now);
  };

  const applyImmediatePlan = useCallback(
    (
      plan: MotionPlan,
      settle: (reason: MotionSettlementReason) => void,
      reason: MotionSettlementReason = 'completed',
    ) => {
      cancelScheduledFrame();
      pendingManagedMotionRef.current = null;
      activeMotionRef.current = null;
      const finalCamera = [...plan.segments].reverse().find((segment) => segment.camera)?.camera;
      if (finalCamera) applyViewport(finalCamera.to);
      overlayStateRef.current = createTransitionFrameManagerState(
        plan.targetSnapshot ?? stableSnapshotRef.current,
      );
      motionPhaseRef.current = 'idle';
      publish(performance.now());
      settle(reason);
    },
    [applyViewport, cancelScheduledFrame, publish],
  );

  const startPlan = useCallback(
    (
      plan: MotionPlan,
      options?: MotionCallbacks,
      settle = createMotionSettlement(options),
    ): NavigationRequestResult => {
      const requestVersion = ++motionRequestVersionRef.current;
      cancelDeferredNavigationFrame('superseded');
      if (motionRequestVersionRef.current !== requestVersion) {
        settle('superseded');
        return { status: 'queued', reason: 'pending-motion' };
      }
      const previousPending = pendingManagedMotionRef.current;
      if (userGestureActiveRef.current || !canvasReadyRef.current) {
        pendingManagedMotionRef.current = {
          plan,
          settle,
        };
        previousPending?.settle('superseded');
        return { status: 'queued', reason: 'pending-motion' };
      }
      const previousActive = activeMotionRef.current;
      if (skipTransitionsRef.current) {
        applyImmediatePlan(plan, settle);
        previousActive?.settle('superseded');
        previousPending?.settle('superseded');
        return { status: 'applied', reason: 'synchronous' };
      }
      pendingManagedMotionRef.current = null;
      cancelScheduledFrame();
      const now = performance.now();
      const currentOverlayState = overlayStateRef.current;
      const firstSegment = plan.segments[0];
      const currentSnapshot = currentOverlayState.transitionFrame
        ? captureDisplayedSnapshot(currentOverlayState, now)
        : (plan.sourceSnapshot ?? currentOverlayState.hostSnapshot);

      let nextOverlayState = createTransitionFrameManagerState(currentSnapshot);
      if (currentOverlayState.transitionFrame && !firstSegment?.overlay) {
        nextOverlayState = freezeOverlayToSnapshot({
          previous: currentOverlayState,
          snapshot: currentSnapshot,
          now,
        });
      }

      overlayStateRef.current = nextOverlayState;
      activeMotionRef.current = {
        plan,
        activeSegmentIndex: 0,
        segmentStartedAt: null,
        segmentSourceViewport: null,
        settle,
      };

      // Install the replacement before callbacks can request another motion.
      previousActive?.settle('superseded');
      previousPending?.settle('superseded');
      if (activeMotionRef.current?.settle !== settle)
        return { status: 'queued', reason: 'motion-plan' };

      if (!firstSegment) {
        finishMotion(now);
        return { status: 'applied', reason: 'synchronous' };
      }

      enterSegmentRef.current(0, now);
      return { status: 'queued', reason: 'motion-plan' };
    },
    [applyImmediatePlan, cancelDeferredNavigationFrame, cancelScheduledFrame, finishMotion],
  );

  const computeNavigationViewport = useCallback(
    (
      intent: NavigationIntent,
      policy: ResolvedNavigationPolicy,
      canvasSize: CanvasSize | null,
    ): ViewportState | null => {
      return resolveNavigationViewport({
        intent,
        policy,
        savedCamera,
        getAnchorBounds,
        scopeRootId,
        canvasSize,
        sceneBounds: getSceneBounds(),
        currentViewport: getObservedViewport(),
        minZoom,
        maxZoom,
        getNodeSetBounds,
      });
    },
    [
      getObservedViewport,

      getNodeSetBounds,
      getSceneBounds,
      maxZoom,
      minZoom,
      savedCamera,
      getAnchorBounds,
      scopeRootId,
    ],
  );

  const navigate = useCallback(
    (
      intent: NavigationIntent,
      options?: MotionCallbacks,
      settle = createMotionSettlement(options),
    ): NavigationRequestResult => {
      const requestVersion = ++motionRequestVersionRef.current;
      cancelDeferredNavigationFrame('superseded');
      if (motionRequestVersionRef.current !== requestVersion) {
        settle('superseded');
        return { status: 'queued', reason: 'pending-motion' };
      }
      if (intent.deferUntilNextFrame) {
        deferredNavigationSettlementRef.current = settle;
        deferredNavigationFrameRef.current = requestAnimationFrame(() => {
          deferredNavigationFrameRef.current = null;
          deferredNavigationSettlementRef.current = null;
          navigate(
            {
              ...intent,
              deferUntilNextFrame: undefined,
            },
            undefined,
            settle,
          );
        });
        return { status: 'queued', reason: 'deferred-frame' };
      }
      const policy = resolveNavigationPolicy(intent);
      const canvasSize = getCurrentCanvasSize();
      const targetViewport = computeNavigationViewport(intent, policy, canvasSize);
      if (!targetViewport) {
        settle('cancelled');
        return canvasSize
          ? { status: 'noop', reason: 'no-target' }
          : { status: 'unavailable', reason: 'missing-canvas' };
      }
      previousCanvasSizeRef.current ??= canvasSize;
      if (intent.kind === 'initialize-diagram') {
        automaticFramingRef.current = savedCamera ? null : { kind: 'fit-scene' };
      } else if (intent.kind === 'fit-scene' || intent.kind === 'fit-node-set') {
        automaticFramingRef.current = intent;
      }
      const currentViewport = getObservedViewport();
      if (viewportStatesEqual(currentViewport, targetViewport)) {
        settle('completed');
        return { status: 'noop', reason: 'same-viewport' };
      }
      return startPlan(
        {
          segments: [
            {
              durationMs: policy.durationMs,
              camera: {
                from: currentViewport,
                to: targetViewport,
              },
            },
          ],
        },
        undefined,
        settle,
      );
    },
    [
      cancelDeferredNavigationFrame,
      computeNavigationViewport,
      savedCamera,
      getCurrentCanvasSize,
      getObservedViewport,
      startPlan,
    ],
  );

  const requestNavigation = useCallback(
    (intent: NavigationIntent, options?: MotionCallbacks): NavigationRequestResult =>
      navigate(intent, options),
    [navigate],
  );

  const startChoreography = useCallback(
    (request: StructuralChoreographyRequest, options?: MotionCallbacks) => {
      automaticFramingRef.current = request.endPointOfInterestNodeIds.length
        ? { kind: 'fit-node-set', nodeIds: request.endPointOfInterestNodeIds, preset: 'focus' }
        : { kind: 'fit-scene' };
      startPlan(
        buildMotionPlanFromChoreographyRequest({
          request,
          canvasSize: getCurrentCanvasSize(),
          minZoom,
          maxZoom,
        }),
        options,
      );
    },
    [
      getCurrentCanvasSize,

      maxZoom,
      minZoom,
      startPlan,
    ],
  );

  const notifyCanvasResize = useCallback(
    (canvasSize: CanvasSize | null) => {
      if (!canvasSize) return;
      const previous = previousCanvasSizeRef.current;
      previousCanvasSizeRef.current = canvasSize;
      if (!previous || !canvasReadyRef.current) return;
      const dx = (canvasSize.width - previous.width) / 2;
      const dy = (canvasSize.height - previous.height) / 2;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
      const shift = (viewport: ViewportState): ViewportState => ({
        ...viewport,
        x: viewport.x + dx,
        y: viewport.y + dy,
      });
      const shiftPlan = (plan: MotionPlan): MotionPlan => ({
        ...plan,
        segments: plan.segments.map((segment) =>
          segment.camera
            ? {
                ...segment,
                camera: { from: shift(segment.camera.from), to: shift(segment.camera.to) },
              }
            : segment,
        ),
      });
      const active = activeMotionRef.current;
      if (active) {
        // Shift both interpolation endpoints so the current frame and remaining path stay continuous.
        activeMotionRef.current = {
          ...active,
          plan: shiftPlan(active.plan),
          segmentSourceViewport: active.segmentSourceViewport
            ? shift(active.segmentSourceViewport)
            : null,
        };
      }
      const pending = pendingManagedMotionRef.current;
      if (pending) pendingManagedMotionRef.current = { ...pending, plan: shiftPlan(pending.plan) };
      const framing = automaticFramingRef.current;
      const fitted =
        !active && !pending && !userGestureActiveRef.current && framing
          ? computeNavigationViewport(framing, resolveNavigationPolicy(framing), canvasSize)
          : null;
      const next = fitted ?? shift(getObservedViewport());
      applyViewport(next);
    },
    [computeNavigationViewport, applyViewport, getObservedViewport],
  );

  const reportUserGestureStart = useCallback(() => {
    // The surface reports the start on the first actual move, after the host viewport changed.
    automaticFramingRef.current = null;
    cancelScheduledFrame();
    userGestureActiveRef.current = true;
    const now = performance.now();
    currentViewportRef.current = getCurrentViewport();
    const currentOverlayState = overlayStateRef.current;
    if (currentOverlayState.transitionFrame) {
      const currentSnapshot = captureDisplayedSnapshot(currentOverlayState, now);
      overlayStateRef.current = freezeOverlayToSnapshot({
        previous: currentOverlayState,
        snapshot: currentSnapshot,
        now,
      });
    }
    const interrupted = activeMotionRef.current;
    if (interrupted?.plan.segments.some((segment) => segment.overlay)) {
      pendingManagedMotionRef.current = {
        plan: {
          ...interrupted.plan,
          segments: interrupted.plan.segments
            .slice(interrupted.activeSegmentIndex)
            .map((segment) => ({ ...segment, camera: undefined })),
        },
        settle: interrupted.settle,
      };
    }
    activeMotionRef.current = null;
    motionPhaseRef.current = 'userGesture';
    publish(now);
    interrupted?.settle('gesture');
  }, [cancelScheduledFrame, getCurrentViewport, publish]);

  const reportUserGestureMove = useCallback((viewport: ViewportState) => {
    if (!viewportStatesEqual(currentViewportRef.current, viewport))
      automaticFramingRef.current = null;
    currentViewportRef.current = viewport;
  }, []);

  const reportUserGestureEnd = useCallback(
    (viewport: ViewportState) => {
      userGestureActiveRef.current = false;
      if (!viewportStatesEqual(currentViewportRef.current, viewport))
        automaticFramingRef.current = null;
      currentViewportRef.current = viewport;
      persistNow(viewport);
      const pendingManagedMotion = pendingManagedMotionRef.current;
      if (pendingManagedMotion && canvasReadyRef.current) {
        pendingManagedMotionRef.current = null;
        startPlan(pendingManagedMotion.plan, undefined, pendingManagedMotion.settle);
        return;
      }
      motionPhaseRef.current = 'idle';
      publish(performance.now());
    },
    [persistNow, publish, startPlan],
  );

  const flushUserGesture = useCallback(() => {
    if (!userGestureActiveRef.current) {
      return false;
    }
    reportUserGestureEnd(getObservedViewport());
    return true;
  }, [getObservedViewport, reportUserGestureEnd]);

  const cancelMotion = useCallback(() => {
    if (!skipTransitions) cancelDeferredNavigationFrame();
    if (skipTransitions && activeMotionRef.current) {
      const active = activeMotionRef.current;
      applyImmediatePlan(active.plan, active.settle, 'cancelled');
      return;
    }
    cancelScheduledFrame();
    if (skipTransitions && pendingManagedMotionRef.current) {
      // Keep the target until the gesture ends or the canvas becomes ready.
      return;
    }
    const pending = pendingManagedMotionRef.current;
    const active = activeMotionRef.current;
    pendingManagedMotionRef.current = null;
    activeMotionRef.current = null;
    const now = performance.now();
    if (overlayStateRef.current.transitionFrame) {
      const snapshot = captureDisplayedSnapshot(overlayStateRef.current, now);
      overlayStateRef.current = freezeOverlayToSnapshot({
        previous: overlayStateRef.current,
        snapshot,
        now,
      });
      motionPhaseRef.current = 'settling';
      publish(now);
      active?.settle('cancelled');
      pending?.settle('cancelled');
      return;
    }
    overlayStateRef.current = syncTransitionFrameManagerStableSnapshot(
      overlayStateRef.current,
      stableSnapshotRef.current,
    );
    motionPhaseRef.current = userGestureActiveRef.current ? 'userGesture' : 'idle';
    publish(now);
    active?.settle('cancelled');
    pending?.settle('cancelled');
  }, [
    applyImmediatePlan,
    cancelDeferredNavigationFrame,
    cancelScheduledFrame,
    publish,
    skipTransitions,
  ]);

  const getCurrentDisplaySnapshot = useCallback(
    () => captureDisplayedSnapshot(overlayStateRef.current, performance.now()),
    [],
  );

  const onCanvasInit = useCallback(
    (instance: CanvasCamera) => {
      onCanvasInitRaw(instance);
      canvasReadyRef.current = true;
      setCanvasReady(true);
      currentViewportRef.current = getCurrentViewport();
      const pendingManagedMotion = pendingManagedMotionRef.current;
      if (pendingManagedMotion && !userGestureActiveRef.current) {
        pendingManagedMotionRef.current = null;
        startPlan(pendingManagedMotion.plan, undefined, pendingManagedMotion.settle);
      }
    },
    [getCurrentViewport, onCanvasInitRaw, startPlan],
  );

  const resetMotionState = useCallback(() => {
    cancelScheduledFrame();
    const deferred = cancelDeferredNavigationFrame('cancelled', false);
    const active = activeMotionRef.current;
    const pending = pendingManagedMotionRef.current;
    activeMotionRef.current = null;
    pendingManagedMotionRef.current = null;
    userGestureActiveRef.current = false;
    previousCanvasSizeRef.current = null;
    automaticFramingRef.current = null;
    overlayStateRef.current = createTransitionFrameManagerState(stableSnapshotRef.current);
    motionPhaseRef.current = 'idle';
    publish(performance.now());
    active?.settle('cancelled');
    pending?.settle('cancelled');
    deferred?.('cancelled');
  }, [cancelDeferredNavigationFrame, cancelScheduledFrame, publish]);

  const onCanvasUnmount = useCallback(() => {
    onCanvasUnmountRaw();
    canvasReadyRef.current = false;
    setCanvasReady(false);
    resetMotionState();
  }, [onCanvasUnmountRaw, resetMotionState]);

  const previousViewportKeyRef = useRef(initialViewportKey);
  useEffect(() => {
    if (previousViewportKeyRef.current === initialViewportKey) return;
    previousViewportKeyRef.current = initialViewportKey;
    resetMotionState();
  }, [initialViewportKey, resetMotionState]);

  useEffect(
    () => () => {
      cancelScheduledFrame();
      cancelDeferredNavigationFrame();
    },
    [cancelDeferredNavigationFrame, cancelScheduledFrame],
  );

  useEffect(() => {
    if (userGestureActiveRef.current) {
      return;
    }

    // Fast Refresh can tear down effects and cancel RAF callbacks while preserving the hook's
    // refs/state. If that happens mid-transition, restart the frame loop from the preserved
    // motion state instead of leaving animations permanently stranded until a full reload.
    const activeMotion = activeMotionRef.current;
    if (activeMotion && activeMotion.segmentStartedAt !== null && rafRef.current === null) {
      scheduleNextFrame();
    }
  });

  useEffect(() => {
    if (activeMotionRef.current || userGestureActiveRef.current) {
      return;
    }
    overlayStateRef.current = syncTransitionFrameManagerStableSnapshot(
      overlayStateRef.current,
      stableSnapshot,
    );
    motionPhaseRef.current = overlayStateRef.current.transitionFrame ? 'settling' : 'idle';
    publish(performance.now());
  }, [publish, stableSnapshot]);

  return useMemo(
    () => ({
      onCanvasInit,
      onCanvasUnmount,
      notifyCanvasResize,
      getCurrentDisplaySnapshot,
      requestNavigation,
      startChoreography,
      cancelMotion,
      reportUserGestureStart,
      reportUserGestureMove,
      reportUserGestureEnd,
      flushUserGesture,
      getCurrentViewport: getObservedViewport,
      canvasReady,
      hostSnapshot: renderState.hostSnapshot,
      transitionFrame: renderState.transitionFrame,
      overlayFrameStore,
      motionPhase: renderState.motionPhase,
      isMotionActive:
        renderState.motionPhase === 'animating' || renderState.motionPhase === 'settling',
    }),
    [
      getCurrentDisplaySnapshot,
      getObservedViewport,
      notifyCanvasResize,
      onCanvasInit,
      onCanvasUnmount,
      renderState,
      overlayFrameStore,
      reportUserGestureEnd,
      flushUserGesture,
      reportUserGestureMove,
      reportUserGestureStart,
      requestNavigation,
      startChoreography,
      cancelMotion,
      canvasReady,
    ],
  );
}
