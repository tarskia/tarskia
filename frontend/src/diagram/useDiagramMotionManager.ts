import type { DiagramCamera, ViewportState } from '@tarskia/diagram-semantics';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasCamera } from '../canvas/camera';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
import { ANIMATION_CONSTANTS } from '../canvas/rendering/transition/animation-constants';
import { resolveStructuralCamera } from '../canvas/rendering/transition/camera';
import {
  buildStaticTransitionFrameState,
  buildTransitionFrameState,
  captureTransitionFrameSnapshot,
  easeMotion,
  resolveAnimationFrame,
  type TransitionFrameState,
} from '../canvas/rendering/transition/overlay';
import { createOverlayFrameStore } from '../canvas/rendering/transition/overlay-frame-store';
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
  MotionSettlementReason,
  NavigationIntent,
  NavigationRequestResult,
  StructuralChoreographyRequest,
} from './motion-types';

interface TransitionFrameManagerState {
  hostSnapshot: CanvasRenderSnapshot;
  transitionFrame: TransitionFrameState | null;
}
const createTransitionFrameManagerState = (
  hostSnapshot: CanvasRenderSnapshot,
): TransitionFrameManagerState => ({ hostSnapshot, transitionFrame: null });
interface ActiveMotion extends PendingManagedMotion {
  startedAt: number;
}

interface PendingManagedMotion {
  plan: MotionPlan;
  settle: (reason: MotionSettlementReason) => void;
}

interface DiagramMotionRenderState extends TransitionFrameManagerState {
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

const freezeOverlayToSnapshot = (
  snapshot: CanvasRenderSnapshot,
  now: number,
): TransitionFrameManagerState => ({
  hostSnapshot: snapshot,
  transitionFrame: buildStaticTransitionFrameState({ snapshot, id: now, startedAt: now }),
});

export const buildMotionPlanFromChoreographyRequest = ({
  request,
  canvasSize,
  minZoom,
  maxZoom,
}: {
  request: StructuralChoreographyRequest;
  canvasSize: CanvasSize | null;
  minZoom: number;
  maxZoom: number;
}): MotionPlan => {
  const target = resolveStructuralCamera({ ...request, canvasSize, minZoom, maxZoom });
  const camera =
    target && !viewportStatesEqual(target, request.currentViewport)
      ? { from: request.currentViewport, to: target }
      : undefined;
  return {
    camera,
    cameraDuration: camera ? ANIMATION_CONSTANTS.viewport.cameraDuration : 0,
    structureDuration: 320,
    settleDuration: 120,
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
      const transitionFrame = overlayState.transitionFrame;
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
      overlayFrameStore.publish(
        transitionFrame ? resolveAnimationFrame(transitionFrame, _now) : null,
      );
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

  const stepRef = useRef<(now: number) => void>(() => {});
  stepRef.current = (now) => {
    const active = activeMotionRef.current;
    if (!active) return;
    const { plan, startedAt } = active;
    const elapsed = Math.max(0, now - startedAt);
    if (plan.camera)
      applyViewport(
        interpolateCameraViewport({
          from: plan.camera.from,
          to: plan.camera.to,
          progress: easeMotion(plan.cameraDuration <= 0 ? 1 : elapsed / plan.cameraDuration),
          canvas: getCurrentCanvasSize() ?? { width: 0, height: 0 },
          minZoom,
          maxZoom,
        }),
      );
    if (elapsed >= plan.cameraDuration + plan.structureDuration + plan.settleDuration) {
      finishMotion(now);
    } else {
      motionPhaseRef.current = 'animating';
      publish(now);
      scheduleNextFrame();
    }
  };

  const applyImmediatePlan = useCallback(
    (
      plan: MotionPlan,
      settle: (reason: MotionSettlementReason) => void,
      reason: MotionSettlementReason = 'completed',
    ) => {
      cancelScheduledFrame();
      pendingManagedMotionRef.current = null;
      const now = performance.now();
      activeMotionRef.current = {
        plan: { ...plan, cameraDuration: 0, structureDuration: 0, settleDuration: 0 },
        startedAt: now,
        settle: () => settle(reason),
      };
      stepRef.current(now);
    },
    [cancelScheduledFrame],
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
      if (!plan.targetSnapshot && previousActive?.plan.targetSnapshot) {
        plan = {
          ...plan,
          targetSnapshot: previousActive.plan.targetSnapshot,
          structureDuration: 320,
          settleDuration: 120,
        };
      }
      if (plan.camera) plan = { ...plan, camera: { ...plan.camera, from: getObservedViewport() } };
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
      const currentSnapshot = currentOverlayState.transitionFrame
        ? captureDisplayedSnapshot(currentOverlayState, now)
        : (plan.sourceSnapshot ?? currentOverlayState.hostSnapshot);
      overlayStateRef.current = {
        ...createTransitionFrameManagerState(currentSnapshot),
        transitionFrame: plan.targetSnapshot
          ? buildTransitionFrameState({
              id: now,
              startedAt: now + plan.cameraDuration,
              duration: plan.structureDuration + plan.settleDuration,
              settleDuration: plan.settleDuration,
              fromPresentation: currentSnapshot,
              toPresentation: plan.targetSnapshot,
            })
          : currentOverlayState.transitionFrame,
      };
      activeMotionRef.current = { plan, startedAt: now, settle };

      // Install the replacement before callbacks can request another motion.
      previousActive?.settle('superseded');
      previousPending?.settle('superseded');
      if (activeMotionRef.current?.settle !== settle)
        return { status: 'queued', reason: 'motion-plan' };

      stepRef.current(now);
      return { status: 'queued', reason: 'motion-plan' };
    },
    [applyImmediatePlan, cancelDeferredNavigationFrame, cancelScheduledFrame, getObservedViewport],
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
          camera: { from: currentViewport, to: targetViewport },
          cameraDuration: policy.durationMs,
          structureDuration: 0,
          settleDuration: 0,
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

  const requestNavigation = navigate;

  const startChoreography = useCallback(
    (request: StructuralChoreographyRequest, options?: MotionCallbacks) => {
      automaticFramingRef.current =
        request.direction === 'in' && request.focus?.kind === 'global'
          ? null
          : request.endPointOfInterestNodeIds.length
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
        camera: plan.camera
          ? { from: shift(plan.camera.from), to: shift(plan.camera.to) }
          : undefined,
      });
      const active = activeMotionRef.current;
      if (active) activeMotionRef.current = { ...active, plan: shiftPlan(active.plan) };
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
      overlayStateRef.current = freezeOverlayToSnapshot(currentSnapshot, now);
    }
    const interrupted = activeMotionRef.current;
    if (interrupted?.plan.targetSnapshot) {
      pendingManagedMotionRef.current = {
        plan: { ...interrupted.plan, camera: undefined, cameraDuration: 0 },
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
      overlayStateRef.current = freezeOverlayToSnapshot(snapshot, now);
      motionPhaseRef.current = 'settling';
      publish(now);
      active?.settle('cancelled');
      pending?.settle('cancelled');
      return;
    }
    overlayStateRef.current = createTransitionFrameManagerState(stableSnapshotRef.current);
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
    if (activeMotion && rafRef.current === null) {
      scheduleNextFrame();
    }
  });

  useEffect(() => {
    if (activeMotionRef.current || userGestureActiveRef.current) {
      return;
    }
    overlayStateRef.current = createTransitionFrameManagerState(stableSnapshot);
    motionPhaseRef.current = overlayStateRef.current.transitionFrame ? 'settling' : 'idle';
    publish(performance.now());
  }, [publish, stableSnapshot]);

  return {
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
  };
}
