import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactFlowInstance } from 'reactflow';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
import { areCanvasRenderSnapshotsEqual } from '../canvas/rendering/presentation/presentation';
import {
  type AnimationSettings,
  DEFAULT_VIEWPORT_FIT_PADDING,
} from '../canvas/rendering/transition/animation-constants';
import { buildStructuralCameraAdvisory } from '../canvas/rendering/transition/camera';
import {
  buildStaticTransitionOverlayState,
  captureTransitionOverlaySnapshot,
  resolveTransitionOverlayFrame,
  type TransitionOverlayFrame,
  type TransitionOverlayState,
} from '../canvas/rendering/transition/overlay';
import {
  buildTimedTransitionPlan,
  buildTimedTransitionSequence,
  type TimedTransitionPlan,
} from '../canvas/rendering/transition/timed-plan';
import {
  advanceManagedTransitionState,
  createTransitionOverlayManagerState,
  notifyManagedTransitionHostSettled,
  startManagedTransitionState,
  syncTransitionOverlayManagerStableSnapshot,
  type TransitionOverlayManagerState,
} from '../canvas/useTransitionOverlayManager';
import { computeViewportForBoundsInVisibleCanvas } from '../canvas/viewport-visibility';
import type { ViewportState } from '../model/types';
import {
  type ResolvedNavigationPolicy,
  resolveNavigationPolicy,
  resolveNavigationViewport,
  viewportStatesEqual,
} from './camera-navigation';
import type { CanvasSize, GetCurrentCanvasSize } from './canvas-size';
import type {
  DiagramCameraPolicy,
  DiagramCameraRect,
  MotionPhase,
  MotionPlan,
  MotionSegment,
  NavigationIntent,
  NavigationRequestResult,
  StructuralChoreographyRequest,
} from './motion-types';

const SNAPSHOT_VISUAL_EPSILON = 0.001;
const MAX_FRAME_DURATION_SAMPLES = 240;
const MIN_STRUCTURAL_OVERLAY_DURATION_MS = 320;
const MAX_STRUCTURAL_CAMERA_DURATION_SCALE = 1.85;
const MIN_OVERLAY_PHASE_TRIM = 0.01;
const MIN_VISIBLE_OVERLAY_PROGRESS = 0.04;

interface ActiveMotion {
  plan: MotionPlan;
  activeSegmentIndex: number;
  segmentStartedAt: number | null;
  segmentSourceViewport: ViewportState | null;
  waitingForHostGeneration: number | null;
  persistFinalViewport: boolean;
  onComplete?: () => void;
}

interface PendingManagedMotion {
  plan: MotionPlan;
  options?: { onComplete?: () => void };
}

interface DiagramMotionRenderState {
  hostSnapshot: CanvasRenderSnapshot;
  transitionOverlay: TransitionOverlayState | null;
  transitionOverlayFrame: TransitionOverlayFrame | null;
  hideHostVisuals: boolean;
  motionPhase: MotionPhase;
  requiredHostGeneration: number | null;
}

interface UseDiagramMotionManagerArgs {
  stableSnapshot: CanvasRenderSnapshot;
  animationSettings: AnimationSettings;
  savedViewport?: ViewportState;
  cameraPolicy?: DiagramCameraPolicy;
  getCurrentCanvasSize: GetCurrentCanvasSize;
  minZoom: number;
  maxZoom: number;
  persistViewport: (viewport: ViewportState) => void;
  onCanvasInit: (instance: ReactFlowInstance) => void;
  onCanvasUnmount: () => void;
  getCurrentViewport: () => ViewportState;
  getLeftOcclusion: () => number;
  getSceneBounds: () => DiagramCameraRect | null;
  getNodeSetBounds: (nodeIds: string[]) => DiagramCameraRect | null;
  setViewport: (viewport: ViewportState) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const easeStructuralCamera = (value: number) => -(Math.cos(Math.PI * value) - 1) / 2;
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

const interpolateViewport = (
  from: ViewportState,
  to: ViewportState,
  progress: number,
): ViewportState => ({
  x: lerp(from.x, to.x, progress),
  y: lerp(from.y, to.y, progress),
  zoom: lerp(from.zoom, to.zoom, progress),
});

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
    if (!requestedIds.has(node.id) || node.opacity <= SNAPSHOT_VISUAL_EPSILON) {
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
    if (node.style.focusShell || node.opacity <= SNAPSHOT_VISUAL_EPSILON) {
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
  leftOcclusion: number;
  minZoom: number;
  maxZoom: number;
}): ViewportState | null => {
  const { snapshot, canvasSize, leftOcclusion, minZoom, maxZoom } = params;
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
    leftOcclusion,
  });
};

const numbersVisuallyEqual = (left: number, right: number) =>
  Math.abs(left - right) <= SNAPSHOT_VISUAL_EPSILON;

const rectsVisuallyEqual = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) =>
  numbersVisuallyEqual(left.x, right.x) &&
  numbersVisuallyEqual(left.y, right.y) &&
  numbersVisuallyEqual(left.width, right.width) &&
  numbersVisuallyEqual(left.height, right.height);

const pointsVisuallyEqual = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  numbersVisuallyEqual(left.x, right.x) && numbersVisuallyEqual(left.y, right.y);

const stringListsEqual = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const edgeGeometryVisuallyEqual = (
  left: CanvasRenderSnapshot['overlayEdges'][number]['geometry'],
  right: TransitionOverlayFrame['edges'][number]['geometry'],
) =>
  left.sourceSide === right.sourceSide &&
  left.targetSide === right.targetSide &&
  pointsVisuallyEqual(left.sourcePoint, right.sourcePoint) &&
  pointsVisuallyEqual(left.control1, right.control1) &&
  pointsVisuallyEqual(left.control2, right.control2) &&
  pointsVisuallyEqual(left.targetPoint, right.targetPoint) &&
  pointsVisuallyEqual(left.labelAnchor, right.labelAnchor);

export const isTransitionOverlayFrameVisuallyEqualToHost = (params: {
  hostSnapshot: CanvasRenderSnapshot;
  transitionOverlayFrame: TransitionOverlayFrame;
}) => {
  const { hostSnapshot, transitionOverlayFrame } = params;
  if (hostSnapshot.nodes.length !== transitionOverlayFrame.nodes.length) {
    return false;
  }
  const overlayNodesById = new Map(transitionOverlayFrame.nodes.map((node) => [node.id, node]));
  for (const hostNode of hostSnapshot.nodes) {
    const overlayNode = overlayNodesById.get(hostNode.id);
    if (!overlayNode) {
      return false;
    }
    if (
      hostNode.kind !== overlayNode.kind ||
      !rectsVisuallyEqual(hostNode.rect, overlayNode.rect) ||
      !numbersVisuallyEqual(hostNode.opacity, overlayNode.opacity)
    ) {
      return false;
    }
  }
  if (hostSnapshot.overlayEdges.length !== transitionOverlayFrame.edges.length) {
    return false;
  }
  const overlayEdgesById = new Map(transitionOverlayFrame.edges.map((edge) => [edge.id, edge]));
  for (const hostEdge of hostSnapshot.overlayEdges) {
    const overlayEdge = overlayEdgesById.get(hostEdge.id);
    if (!overlayEdge) {
      return false;
    }
    if (
      hostEdge.relationId !== overlayEdge.relationId ||
      hostEdge.kind !== overlayEdge.kind ||
      hostEdge.sourceId !== overlayEdge.sourceId ||
      hostEdge.targetId !== overlayEdge.targetId ||
      hostEdge.scopeId !== overlayEdge.scopeId ||
      hostEdge.label !== overlayEdge.label ||
      hostEdge.state !== overlayEdge.state ||
      hostEdge.matched !== overlayEdge.matched ||
      !numbersVisuallyEqual(hostEdge.opacity, overlayEdge.opacity) ||
      !edgeGeometryVisuallyEqual(hostEdge.geometry, overlayEdge.geometry) ||
      !stringListsEqual(hostEdge.solidOverNodeIds, overlayEdge.solidOverNodeIds)
    ) {
      return false;
    }
  }
  return true;
};

export const shouldDisplayTransitionOverlay = (params: {
  phase: TransitionOverlayManagerState['phase'];
  hostSnapshot: CanvasRenderSnapshot;
  transitionOverlay: TransitionOverlayState | null;
  transitionOverlayFrame: TransitionOverlayFrame | null;
}) => {
  const { phase, hostSnapshot, transitionOverlay, transitionOverlayFrame } = params;
  if (!transitionOverlay || !transitionOverlayFrame) {
    return false;
  }
  if (phase !== 'animating') {
    return true;
  }
  if (transitionOverlayFrame.progress < MIN_VISIBLE_OVERLAY_PROGRESS) {
    return false;
  }
  return !isTransitionOverlayFrameVisuallyEqualToHost({
    hostSnapshot,
    transitionOverlayFrame,
  });
};

const preserveOverlayCounters = (
  next: TransitionOverlayManagerState,
  previous: TransitionOverlayManagerState,
): TransitionOverlayManagerState => ({
  ...next,
  settledHostGeneration: previous.settledHostGeneration,
  nextHostGeneration: previous.nextHostGeneration,
});

const captureDisplayedSnapshot = (
  overlayState: TransitionOverlayManagerState,
  now: number,
): CanvasRenderSnapshot => {
  if (!overlayState.transitionOverlay) {
    return overlayState.hostSnapshot;
  }
  return captureTransitionOverlaySnapshot({
    state: overlayState.transitionOverlay,
    frame: resolveTransitionOverlayFrame(overlayState.transitionOverlay, now),
  });
};

const freezeOverlayToSnapshot = (params: {
  previous: TransitionOverlayManagerState;
  snapshot: CanvasRenderSnapshot;
  now: number;
}): TransitionOverlayManagerState => {
  const { previous, snapshot, now } = params;
  const requiredHostGeneration = previous.nextHostGeneration + 1;
  const overlay = buildStaticTransitionOverlayState({
    snapshot,
    id: now,
    startedAt: now,
  });
  return {
    ...previous,
    hostSnapshot: snapshot,
    transitionOverlay: overlay,
    active: {
      outgoingSnapshot: snapshot,
      incomingSnapshot: snapshot,
      overlay,
      startedAt: now,
      duration: 1,
      requiredHostGeneration,
      hostSettled: previous.settledHostGeneration >= requiredHostGeneration,
      animationComplete: true,
      finalFrameSnapshot: snapshot,
    },
    phase: 'settling',
    requiredHostGeneration,
    nextHostGeneration: requiredHostGeneration,
  };
};

const freezeDisplayWhileHostSnapshotSettles = (params: {
  previous: TransitionOverlayManagerState;
  displaySnapshot: CanvasRenderSnapshot;
  incomingSnapshot: CanvasRenderSnapshot;
  now: number;
}): TransitionOverlayManagerState => {
  const { previous, displaySnapshot, incomingSnapshot, now } = params;
  const requiredHostGeneration = previous.nextHostGeneration + 1;
  const overlay = buildStaticTransitionOverlayState({
    snapshot: displaySnapshot,
    id: now,
    startedAt: now,
  });
  return {
    ...previous,
    hostSnapshot: incomingSnapshot,
    transitionOverlay: overlay,
    active: {
      outgoingSnapshot: displaySnapshot,
      incomingSnapshot,
      overlay,
      startedAt: now,
      duration: 1,
      requiredHostGeneration,
      hostSettled: previous.settledHostGeneration >= requiredHostGeneration,
      animationComplete: true,
      finalFrameSnapshot: displaySnapshot,
    },
    phase: 'settling',
    requiredHostGeneration,
    nextHostGeneration: requiredHostGeneration,
  };
};

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

export const computeStructuralOverlayPhaseWindow = (timedPlan: TimedTransitionPlan) => {
  const startCandidates: number[] = [];
  for (const timing of timedPlan.nodeTimings.values()) {
    startCandidates.push(
      timing.moveX?.start ?? Number.POSITIVE_INFINITY,
      timing.moveY?.start ?? Number.POSITIVE_INFINITY,
      timing.resizeX?.start ?? Number.POSITIVE_INFINITY,
      timing.resizeY?.start ?? Number.POSITIVE_INFINITY,
      timing.fade?.start ?? Number.POSITIVE_INFINITY,
    );
  }
  for (const childFade of timedPlan.childFadeByParent.values()) {
    startCandidates.push(childFade.window.start);
  }
  for (const edgePlan of timedPlan.edgePlans) {
    if (edgePlan.fade) {
      startCandidates.push(edgePlan.fade.start);
    }
  }
  const earliestStart = Math.min(...startCandidates);
  if (!Number.isFinite(earliestStart) || earliestStart < MIN_OVERLAY_PHASE_TRIM) {
    return { start: 0, end: 1 };
  }
  return {
    start: clamp(earliestStart, 0, 0.95),
    end: 1,
  };
};

export const buildMotionPlanFromChoreographyRequest = (params: {
  request: StructuralChoreographyRequest;
  animationSettings: AnimationSettings;
  cameraPolicy?: DiagramCameraPolicy;
  canvasSize: CanvasSize | null;
  leftOcclusion: number;
  minZoom: number;
  maxZoom: number;
}): MotionPlan => {
  const { request, animationSettings, cameraPolicy, canvasSize, leftOcclusion, minZoom, maxZoom } =
    params;
  const timedSequence = buildTimedTransitionSequence({
    planningAdvisory: request.planningAdvisory,
    animationSettings,
  });
  const timedPlan = buildTimedTransitionPlan({
    planningAdvisory: request.planningAdvisory,
    animationSettings,
    timedSequence,
  });
  const cameraAdvisory = buildStructuralCameraAdvisory({
    direction: request.direction,
    focus: request.focus,
    startLayout: request.startLayout,
    endLayout: request.endLayout,
    currentViewport: request.currentViewport,
    canvasSize,
    leftOcclusion,
    endPointOfInterestNodeIds: request.endPointOfInterestNodeIds,
    collectSubtreeIds: request.collectSubtreeIds,
    padding: animationSettings.viewport.padding,
    minZoom,
    maxZoom,
  });

  const cameraDurationMs = Math.max(0, animationSettings.viewport.cameraDuration);
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
      leftOcclusion,
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
          durationMs: Math.max(0, animationSettings.viewport.fitDuration),
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
          choreographyCameraDurationMs: Math.max(0, animationSettings.viewport.fitDuration),
          hasStructuredPhases: request.planningAdvisory.sequence.steps.length > 0,
        }),
        overlay: {
          incomingSnapshot: request.endSnapshot,
          planningAdvisory: request.planningAdvisory,
          timedPlan,
          timedSequence,
          phaseWindow: computeStructuralOverlayPhaseWindow(timedPlan),
        },
      });

      return {
        segments,
        sourceSnapshot: request.startSnapshot,
        targetSnapshot: request.endSnapshot,
        persistFinalViewport: request.persistFinalViewport ?? true,
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
      phaseWindow: computeStructuralOverlayPhaseWindow(timedPlan),
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
    persistFinalViewport: request.persistFinalViewport ?? true,
  };
};

export function useDiagramMotionManager({
  stableSnapshot,
  animationSettings,
  savedViewport,
  cameraPolicy,
  getCurrentCanvasSize,
  minZoom,
  maxZoom,
  persistViewport,
  onCanvasInit: onCanvasInitRaw,
  onCanvasUnmount: onCanvasUnmountRaw,
  getCurrentViewport,
  getLeftOcclusion,
  getSceneBounds,
  getNodeSetBounds,
  setViewport,
}: UseDiagramMotionManagerArgs) {
  const [renderState, setRenderState] = useState<DiagramMotionRenderState>(() => ({
    hostSnapshot: stableSnapshot,
    transitionOverlay: null,
    transitionOverlayFrame: null,
    hideHostVisuals: false,
    motionPhase: 'idle',
    requiredHostGeneration: null,
  }));
  const overlayStateRef = useRef(createTransitionOverlayManagerState(stableSnapshot));
  const stableSnapshotRef = useRef(stableSnapshot);
  const activeMotionRef = useRef<ActiveMotion | null>(null);
  const pendingManagedMotionRef = useRef<PendingManagedMotion | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const canvasReadyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number | null>(null);
  const frameDurationsRef = useRef<number[]>([]);
  const motionPhaseRef = useRef<MotionPhase>('idle');
  const userGestureActiveRef = useRef(false);
  const deferredNavigationFrameRef = useRef<number | null>(null);
  const currentViewportRef = useRef<ViewportState>(getCurrentViewport());

  stableSnapshotRef.current = stableSnapshot;

  const cancelScheduledFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cancelDeferredNavigationFrame = useCallback(() => {
    if (deferredNavigationFrameRef.current !== null) {
      cancelAnimationFrame(deferredNavigationFrameRef.current);
      deferredNavigationFrameRef.current = null;
    }
  }, []);

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

  const publish = useCallback((_now: number) => {
    const overlayState = overlayStateRef.current;
    const nextTransitionOverlay = overlayState.transitionOverlay;
    const nextTransitionOverlayFrame = nextTransitionOverlay
      ? resolveTransitionOverlayFrame(nextTransitionOverlay, _now)
      : null;
    const showTransitionOverlay = shouldDisplayTransitionOverlay({
      phase: overlayState.phase,
      hostSnapshot: overlayState.hostSnapshot,
      transitionOverlay: nextTransitionOverlay,
      transitionOverlayFrame: nextTransitionOverlayFrame,
    });
    const transitionOverlay = showTransitionOverlay ? nextTransitionOverlay : null;
    const transitionOverlayFrame = showTransitionOverlay ? nextTransitionOverlayFrame : null;
    setRenderState((previous) => {
      const next = {
        hostSnapshot: overlayState.hostSnapshot,
        transitionOverlay,
        transitionOverlayFrame,
        hideHostVisuals: showTransitionOverlay,
        motionPhase: motionPhaseRef.current,
        requiredHostGeneration: overlayState.requiredHostGeneration,
      } satisfies DiagramMotionRenderState;
      if (
        areCanvasRenderSnapshotsEqual(previous.hostSnapshot, next.hostSnapshot) &&
        previous.transitionOverlay === next.transitionOverlay &&
        previous.transitionOverlayFrame === next.transitionOverlayFrame &&
        previous.hideHostVisuals === next.hideHostVisuals &&
        previous.motionPhase === next.motionPhase &&
        previous.requiredHostGeneration === next.requiredHostGeneration
      ) {
        return previous;
      }
      return next;
    });
  }, []);

  const recordFrameDuration = useCallback((now: number) => {
    if (lastFrameAtRef.current === null) {
      lastFrameAtRef.current = now;
      return;
    }
    const dt = now - lastFrameAtRef.current;
    lastFrameAtRef.current = now;
    if (!Number.isFinite(dt) || dt < 0) {
      return;
    }
    const next = [...frameDurationsRef.current, dt];
    if (next.length > MAX_FRAME_DURATION_SAMPLES) {
      next.shift();
    }
    frameDurationsRef.current = next;
  }, []);

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
      lastFrameAtRef.current = null;
      frameDurationsRef.current = [];
      if (!overlayStateRef.current.transitionOverlay) {
        overlayStateRef.current = syncTransitionOverlayManagerStableSnapshot(
          overlayStateRef.current,
          stableSnapshotRef.current,
        );
      }
      motionPhaseRef.current = overlayStateRef.current.transitionOverlay ? 'settling' : 'idle';
      const callback = activeMotion?.onComplete;
      if (activeMotion?.persistFinalViewport) {
        persistNow(getObservedViewport());
      }
      publish(now);
      callback?.();
    },
    [getObservedViewport, persistNow, publish],
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
    let segmentStartedAt: number | null = now;
    let waitingForHostGeneration: number | null = null;

    if (segment.hostSnapshot) {
      const displaySnapshot = captureDisplayedSnapshot(overlayState, now);
      overlayState = freezeDisplayWhileHostSnapshotSettles({
        previous: overlayState,
        displaySnapshot,
        incomingSnapshot: segment.hostSnapshot,
        now,
      });
      const requiredHostGeneration = overlayState.requiredHostGeneration;
      if (
        requiredHostGeneration !== null &&
        overlayState.settledHostGeneration < requiredHostGeneration
      ) {
        segmentStartedAt = null;
        waitingForHostGeneration = requiredHostGeneration;
      }
    } else if (segment.overlay) {
      overlayState = startManagedTransitionState(overlayState, {
        incomingSnapshot: segment.overlay.incomingSnapshot,
        planningAdvisory: segment.overlay.planningAdvisory,
        timedPlan: segment.overlay.timedPlan,
        timedSequence: segment.overlay.timedSequence,
        duration: Math.max(1, segment.durationMs),
        phaseWindow: segment.overlay.phaseWindow,
        sharedNodeGeometry: segment.overlay.sharedNodeGeometry,
        now,
      });
    } else {
      const existingFreezeBarrier =
        overlayState.transitionOverlay &&
        overlayState.phase === 'settling' &&
        overlayState.requiredHostGeneration !== null
          ? overlayState.requiredHostGeneration
          : null;
      if (existingFreezeBarrier !== null) {
        if (overlayState.settledHostGeneration < existingFreezeBarrier) {
          segmentStartedAt = null;
          waitingForHostGeneration = existingFreezeBarrier;
        }
      } else if (segment.waitForHostGeneration) {
        const requiredHostGeneration = overlayState.nextHostGeneration + 1;
        overlayState = {
          ...overlayState,
          requiredHostGeneration,
          nextHostGeneration: requiredHostGeneration,
        };
        if (overlayState.settledHostGeneration >= requiredHostGeneration) {
          overlayState = {
            ...overlayState,
            requiredHostGeneration: null,
          };
        } else {
          segmentStartedAt = null;
          waitingForHostGeneration = requiredHostGeneration;
        }
      }
    }

    overlayStateRef.current = overlayState;
    const cameraStartViewport = segment.camera?.from ?? getObservedViewport();

    activeMotionRef.current = {
      ...activeMotion,
      activeSegmentIndex: segmentIndex,
      segmentStartedAt,
      segmentSourceViewport: segmentStartedAt !== null ? cameraStartViewport : null,
      waitingForHostGeneration,
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
    recordFrameDuration(now);
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
      const currentViewport = interpolateViewport(sourceViewport, segment.camera.to, eased);
      applyViewport(currentViewport);
      cameraDone = rawProgress >= 1;
    }
    const pauseDone =
      !isTimedPauseSegment(segment) ||
      now - activeMotion.segmentStartedAt >= Math.max(0, segment.durationMs);

    const overlayState = overlayStateRef.current;
    const overlayDone =
      !segment.overlay ||
      (overlayState.transitionOverlay === null && overlayState.phase === 'idle');
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

  const startPlan = useCallback(
    (plan: MotionPlan, options?: { onComplete?: () => void }): NavigationRequestResult => {
      if (userGestureActiveRef.current || !canvasReadyRef.current) {
        pendingManagedMotionRef.current = {
          plan,
          options,
        };
        return { status: 'queued', reason: 'pending-motion' };
      }
      pendingManagedMotionRef.current = null;
      cancelScheduledFrame();
      const now = performance.now();
      const currentOverlayState = overlayStateRef.current;
      const firstSegment = plan.segments[0];
      const currentSnapshot = currentOverlayState.transitionOverlay
        ? captureDisplayedSnapshot(currentOverlayState, now)
        : (plan.sourceSnapshot ?? currentOverlayState.hostSnapshot);

      let nextOverlayState = preserveOverlayCounters(
        createTransitionOverlayManagerState(currentSnapshot),
        currentOverlayState,
      );
      if (currentOverlayState.transitionOverlay && !firstSegment?.overlay) {
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
        waitingForHostGeneration: null,
        persistFinalViewport: plan.persistFinalViewport ?? false,
        onComplete: options?.onComplete,
      };

      if (!firstSegment) {
        finishMotion(now);
        return { status: 'applied', reason: 'synchronous' };
      }

      enterSegmentRef.current(0, now);
      return { status: 'queued', reason: 'motion-plan' };
    },
    [cancelScheduledFrame, finishMotion],
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
        savedViewport,
        canvasSize,
        sceneBounds: getSceneBounds(),
        currentViewport: getObservedViewport(),
        leftOcclusion: getLeftOcclusion(),
        minZoom,
        maxZoom,
        getNodeSetBounds,
      });
    },
    [
      getObservedViewport,
      getLeftOcclusion,
      getNodeSetBounds,
      getSceneBounds,
      maxZoom,
      minZoom,
      savedViewport,
    ],
  );

  const navigate = useCallback(
    (intent: NavigationIntent, options?: { onComplete?: () => void }): NavigationRequestResult => {
      if (intent.deferUntilNextFrame) {
        cancelDeferredNavigationFrame();
        deferredNavigationFrameRef.current = requestAnimationFrame(() => {
          deferredNavigationFrameRef.current = null;
          navigate(
            {
              ...intent,
              deferUntilNextFrame: undefined,
            },
            options,
          );
        });
        return { status: 'queued', reason: 'deferred-frame' };
      }
      const policy = resolveNavigationPolicy(intent, animationSettings, cameraPolicy);
      const canvasSize = getCurrentCanvasSize();
      const targetViewport = computeNavigationViewport(intent, policy, canvasSize);
      if (!targetViewport) {
        return canvasSize
          ? { status: 'noop', reason: 'no-target' }
          : { status: 'unavailable', reason: 'missing-canvas' };
      }
      const currentViewport = getObservedViewport();
      if (viewportStatesEqual(currentViewport, targetViewport)) {
        if (policy.persist) {
          persistNow(targetViewport);
        }
        options?.onComplete?.();
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
              waitForHostGeneration: policy.waitForHostGeneration,
            },
          ],
          persistFinalViewport: policy.persist,
        },
        options,
      );
    },
    [
      animationSettings,
      cancelDeferredNavigationFrame,
      computeNavigationViewport,
      getCurrentCanvasSize,
      getObservedViewport,
      persistNow,
      startPlan,
      cameraPolicy,
    ],
  );

  const requestNavigation = useCallback(
    (intent: NavigationIntent): NavigationRequestResult => navigate(intent),
    [navigate],
  );

  const startChoreography = useCallback(
    (request: StructuralChoreographyRequest, options?: { onComplete?: () => void }) => {
      startPlan(
        buildMotionPlanFromChoreographyRequest({
          request,
          animationSettings,
          cameraPolicy,
          canvasSize: getCurrentCanvasSize(),
          leftOcclusion: getLeftOcclusion(),
          minZoom,
          maxZoom,
        }),
        options,
      );
    },
    [
      animationSettings,
      cameraPolicy,
      getCurrentCanvasSize,
      getLeftOcclusion,
      maxZoom,
      minZoom,
      startPlan,
    ],
  );

  const reportUserGestureStart = useCallback(() => {
    cancelScheduledFrame();
    userGestureActiveRef.current = true;
    const now = performance.now();
    currentViewportRef.current = getCurrentViewport();
    const currentOverlayState = overlayStateRef.current;
    if (currentOverlayState.transitionOverlay) {
      const currentSnapshot = captureDisplayedSnapshot(currentOverlayState, now);
      overlayStateRef.current = freezeOverlayToSnapshot({
        previous: currentOverlayState,
        snapshot: currentSnapshot,
        now,
      });
    }
    activeMotionRef.current = null;
    motionPhaseRef.current = 'userGesture';
    publish(now);
  }, [cancelScheduledFrame, getCurrentViewport, publish]);

  const reportUserGestureMove = useCallback((viewport: ViewportState) => {
    currentViewportRef.current = viewport;
  }, []);

  const reportUserGestureEnd = useCallback(
    (viewport: ViewportState) => {
      userGestureActiveRef.current = false;
      currentViewportRef.current = viewport;
      persistNow(viewport);
      const pendingManagedMotion = pendingManagedMotionRef.current;
      if (pendingManagedMotion && canvasReadyRef.current) {
        pendingManagedMotionRef.current = null;
        startPlan(pendingManagedMotion.plan, pendingManagedMotion.options);
        return;
      }
      motionPhaseRef.current = overlayStateRef.current.transitionOverlay ? 'settling' : 'idle';
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
    cancelScheduledFrame();
    pendingManagedMotionRef.current = null;
    activeMotionRef.current = null;
    const now = performance.now();
    if (overlayStateRef.current.transitionOverlay) {
      const snapshot = captureDisplayedSnapshot(overlayStateRef.current, now);
      overlayStateRef.current = freezeOverlayToSnapshot({
        previous: overlayStateRef.current,
        snapshot,
        now,
      });
      motionPhaseRef.current = 'settling';
      publish(now);
      return;
    }
    overlayStateRef.current = syncTransitionOverlayManagerStableSnapshot(
      overlayStateRef.current,
      stableSnapshotRef.current,
    );
    motionPhaseRef.current = userGestureActiveRef.current ? 'userGesture' : 'idle';
    publish(now);
  }, [cancelScheduledFrame, publish]);

  const getCurrentDisplaySnapshot = useCallback(
    () => captureDisplayedSnapshot(overlayStateRef.current, performance.now()),
    [],
  );

  const notifyDisplayHostSettled = useCallback(
    (generation: number) => {
      overlayStateRef.current = notifyManagedTransitionHostSettled(
        overlayStateRef.current,
        generation,
      );
      const activeMotion = activeMotionRef.current;
      if (
        activeMotion &&
        activeMotion.segmentStartedAt === null &&
        activeMotion.waitingForHostGeneration !== null &&
        generation >= activeMotion.waitingForHostGeneration
      ) {
        overlayStateRef.current = {
          ...overlayStateRef.current,
          requiredHostGeneration: null,
        };
        activeMotionRef.current = {
          ...activeMotion,
          segmentStartedAt: performance.now(),
          segmentSourceViewport:
            activeMotion.plan.segments[activeMotion.activeSegmentIndex]?.camera?.from ??
            getObservedViewport(),
          waitingForHostGeneration: null,
        };
        motionPhaseRef.current = userGestureActiveRef.current ? 'userGesture' : 'animating';
        const segment = activeMotion.plan.segments[activeMotion.activeSegmentIndex];
        if (segment?.durationMs <= 0 && !segment.overlay) {
          const targetViewport = getSegmentCameraTarget(segment);
          if (targetViewport) {
            applyViewport(targetViewport);
          }
          enterSegmentRef.current(activeMotion.activeSegmentIndex + 1, performance.now());
          return;
        }
        scheduleNextFrame();
      } else if (
        activeMotion?.plan.segments[activeMotion.activeSegmentIndex]?.overlay &&
        overlayStateRef.current.phase === 'idle' &&
        overlayStateRef.current.transitionOverlay === null
      ) {
        enterSegmentRef.current(activeMotion.activeSegmentIndex + 1, performance.now());
        return;
      } else if (
        !activeMotion &&
        !userGestureActiveRef.current &&
        overlayStateRef.current.transitionOverlay === null
      ) {
        motionPhaseRef.current = 'idle';
      }
      publish(performance.now());
    },
    [applyViewport, getObservedViewport, publish, scheduleNextFrame],
  );

  const onCanvasInit = useCallback(
    (instance: ReactFlowInstance) => {
      onCanvasInitRaw(instance);
      canvasReadyRef.current = true;
      setCanvasReady(true);
      currentViewportRef.current = getCurrentViewport();
      const pendingManagedMotion = pendingManagedMotionRef.current;
      if (pendingManagedMotion && !userGestureActiveRef.current) {
        pendingManagedMotionRef.current = null;
        startPlan(pendingManagedMotion.plan, pendingManagedMotion.options);
      }
    },
    [getCurrentViewport, onCanvasInitRaw, startPlan],
  );

  const onCanvasUnmount = useCallback(() => {
    onCanvasUnmountRaw();
    cancelScheduledFrame();
    cancelDeferredNavigationFrame();
    activeMotionRef.current = null;
    pendingManagedMotionRef.current = null;
    canvasReadyRef.current = false;
    setCanvasReady(false);
    lastFrameAtRef.current = null;
    frameDurationsRef.current = [];
    motionPhaseRef.current = 'idle';
    publish(performance.now());
  }, [cancelDeferredNavigationFrame, cancelScheduledFrame, onCanvasUnmountRaw, publish]);

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
    if (
      renderState.motionPhase !== 'idle' ||
      activeMotionRef.current ||
      userGestureActiveRef.current
    ) {
      return;
    }
    overlayStateRef.current = syncTransitionOverlayManagerStableSnapshot(
      overlayStateRef.current,
      stableSnapshot,
    );
    motionPhaseRef.current = overlayStateRef.current.transitionOverlay ? 'settling' : 'idle';
    publish(performance.now());
  }, [publish, renderState.motionPhase, stableSnapshot]);

  return useMemo(
    () => ({
      onCanvasInit,
      onCanvasUnmount,
      getCurrentDisplaySnapshot,
      requestNavigation,
      startChoreography,
      cancelMotion,
      reportUserGestureStart,
      reportUserGestureMove,
      reportUserGestureEnd,
      flushUserGesture,
      notifyDisplayHostSettled,
      getCurrentViewport: getObservedViewport,
      canvasReady,
      hostSnapshot: renderState.hostSnapshot,
      transitionOverlay: renderState.transitionOverlay,
      transitionOverlayFrame: renderState.transitionOverlayFrame,
      hideHostVisuals: renderState.hideHostVisuals,
      motionPhase: renderState.motionPhase,
      requiredHostGeneration: renderState.requiredHostGeneration,
      frameDurations: frameDurationsRef.current,
      isMotionActive:
        renderState.motionPhase === 'animating' || renderState.motionPhase === 'settling',
    }),
    [
      getCurrentDisplaySnapshot,
      getObservedViewport,
      notifyDisplayHostSettled,
      onCanvasInit,
      onCanvasUnmount,
      renderState,
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
