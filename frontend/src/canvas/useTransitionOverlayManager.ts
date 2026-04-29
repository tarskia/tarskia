import {
  areCanvasRenderSnapshotsEqual,
  type CanvasRenderSnapshot,
} from './rendering/presentation/presentation';
import {
  buildStaticTransitionOverlayState,
  buildTransitionOverlayState,
  captureTransitionOverlaySnapshot,
  resolveTransitionOverlayFrame,
  type TransitionOverlayState,
} from './rendering/transition/overlay';
import type { TransitionPlanningAdvisory } from './rendering/transition/sequencer';
import type {
  TimedTransitionPlan,
  TimedTransitionSequence,
} from './rendering/transition/timed-plan';

const MAX_FRAME_DURATION_SAMPLES = 240;

export type ManagerPhase = 'idle' | 'animating' | 'settling';

export interface ManagedTransitionState {
  outgoingSnapshot: CanvasRenderSnapshot;
  incomingSnapshot: CanvasRenderSnapshot;
  overlay: TransitionOverlayState;
  startedAt: number;
  duration: number;
  requiredHostGeneration: number;
  hostSettled: boolean;
  animationComplete: boolean;
  finalFrameSnapshot: CanvasRenderSnapshot;
  lastFrameAt?: number;
}

export interface TransitionOverlayManagerState {
  committedSnapshot: CanvasRenderSnapshot;
  hostSnapshot: CanvasRenderSnapshot;
  transitionOverlay: TransitionOverlayState | null;
  active: ManagedTransitionState | null;
  phase: ManagerPhase;
  requiredHostGeneration: number | null;
  settledHostGeneration: number;
  nextHostGeneration: number;
  frameDurations: number[];
}

export interface StartManagedTransitionArgs {
  incomingSnapshot: CanvasRenderSnapshot;
  planningAdvisory: TransitionPlanningAdvisory;
  timedPlan: TimedTransitionPlan;
  timedSequence: TimedTransitionSequence;
  duration: number;
  phaseWindow?: { start: number; end: number };
  sharedNodeGeometry?: 'freeze-from';
}

const finalizeManagedTransitionState = (
  state: TransitionOverlayManagerState,
): TransitionOverlayManagerState => {
  const active = state.active;
  if (!active) {
    return state;
  }
  return {
    ...state,
    committedSnapshot: active.incomingSnapshot,
    hostSnapshot: active.incomingSnapshot,
    transitionOverlay: null,
    active: null,
    phase: 'idle',
    requiredHostGeneration: null,
  };
};

const captureManagedTransitionSnapshot = (active: ManagedTransitionState, now: number) =>
  captureTransitionOverlaySnapshot({
    state: active.overlay,
    frame: resolveTransitionOverlayFrame(active.overlay, now),
  });

const recordFrameDuration = (samples: number[], lastFrameAt: number | undefined, now: number) => {
  if (typeof lastFrameAt !== 'number') {
    return samples;
  }
  const dt = now - lastFrameAt;
  if (!Number.isFinite(dt) || dt < 0) {
    return samples;
  }
  const next = [...samples, dt];
  if (next.length > MAX_FRAME_DURATION_SAMPLES) {
    next.shift();
  }
  return next;
};

export const createTransitionOverlayManagerState = (
  stableSnapshot: CanvasRenderSnapshot,
): TransitionOverlayManagerState => ({
  committedSnapshot: stableSnapshot,
  hostSnapshot: stableSnapshot,
  transitionOverlay: null,
  active: null,
  phase: 'idle',
  requiredHostGeneration: null,
  settledHostGeneration: 0,
  nextHostGeneration: 0,
  frameDurations: [],
});

export const syncTransitionOverlayManagerStableSnapshot = (
  state: TransitionOverlayManagerState,
  stableSnapshot: CanvasRenderSnapshot,
): TransitionOverlayManagerState => {
  if (state.active) {
    return state;
  }
  if (
    areCanvasRenderSnapshotsEqual(state.committedSnapshot, stableSnapshot) &&
    areCanvasRenderSnapshotsEqual(state.hostSnapshot, stableSnapshot) &&
    state.transitionOverlay === null &&
    state.requiredHostGeneration === null &&
    state.phase === 'idle'
  ) {
    return state;
  }
  return {
    ...state,
    committedSnapshot: stableSnapshot,
    hostSnapshot: stableSnapshot,
    transitionOverlay: null,
    phase: 'idle',
    requiredHostGeneration: null,
  };
};

export const startManagedTransitionState = (
  state: TransitionOverlayManagerState,
  args: StartManagedTransitionArgs & { now: number },
): TransitionOverlayManagerState => {
  const {
    incomingSnapshot,
    planningAdvisory,
    timedPlan,
    timedSequence,
    duration,
    phaseWindow,
    sharedNodeGeometry,
    now,
  } = args;
  const outgoingSnapshot = state.active
    ? captureManagedTransitionSnapshot(state.active, now)
    : state.committedSnapshot;
  const requiredHostGeneration = state.nextHostGeneration + 1;
  const overlay = buildTransitionOverlayState({
    id: now,
    startedAt: now,
    duration,
    phaseWindow,
    planningAdvisory,
    timedPlan,
    timedSequence,
    sharedNodeGeometry,
    fromPresentation: outgoingSnapshot,
    toPresentation: incomingSnapshot,
  });
  return {
    ...state,
    hostSnapshot: outgoingSnapshot,
    transitionOverlay: overlay,
    active: {
      outgoingSnapshot,
      incomingSnapshot,
      overlay,
      startedAt: now,
      duration,
      requiredHostGeneration,
      hostSettled: state.settledHostGeneration >= requiredHostGeneration,
      animationComplete: false,
      finalFrameSnapshot: incomingSnapshot,
    },
    phase: 'animating',
    requiredHostGeneration,
    nextHostGeneration: requiredHostGeneration,
    frameDurations: [],
  };
};

export const advanceManagedTransitionState = (
  state: TransitionOverlayManagerState,
  now: number,
): { state: TransitionOverlayManagerState; animationCompleted: boolean } => {
  const active = state.active;
  if (!active) {
    return {
      state,
      animationCompleted: false,
    };
  }
  const frameDurations = recordFrameDuration(state.frameDurations, active.lastFrameAt, now);
  const progressing = {
    ...active,
    lastFrameAt: now,
  };
  const progress = Math.min(1, (now - active.startedAt) / Math.max(active.duration, 1));
  if (progress < 1) {
    return {
      state: {
        ...state,
        active: progressing,
        frameDurations,
      },
      animationCompleted: false,
    };
  }

  const finalFrame = resolveTransitionOverlayFrame(
    active.overlay,
    active.startedAt + active.duration,
  );
  const finalFrameSnapshot = captureTransitionOverlaySnapshot({
    state: active.overlay,
    frame: finalFrame,
  });
  const completed = {
    ...progressing,
    animationComplete: true,
    hostSettled:
      progressing.hostSettled || state.settledHostGeneration >= progressing.requiredHostGeneration,
    finalFrameSnapshot,
  };
  const completedState = {
    ...state,
    active: completed,
    frameDurations,
  };
  if (completed.hostSettled) {
    return {
      state: finalizeManagedTransitionState(completedState),
      animationCompleted: true,
    };
  }
  const frozenOverlay = buildStaticTransitionOverlayState({
    snapshot: finalFrameSnapshot,
    id: now,
    startedAt: now,
  });
  return {
    state: {
      ...completedState,
      hostSnapshot: completed.incomingSnapshot,
      transitionOverlay: frozenOverlay,
      active: {
        ...completed,
        overlay: frozenOverlay,
      },
      phase: 'settling',
    },
    animationCompleted: true,
  };
};

export const cancelManagedTransitionState = (
  state: TransitionOverlayManagerState,
  now: number,
): TransitionOverlayManagerState => {
  const active = state.active;
  if (!active) {
    return state;
  }
  const finalFrameSnapshot = captureManagedTransitionSnapshot(active, now);
  const frozenOverlay = buildStaticTransitionOverlayState({
    snapshot: finalFrameSnapshot,
    id: now,
    startedAt: now,
  });
  const cancelledState = {
    ...state,
    hostSnapshot: active.incomingSnapshot,
    transitionOverlay: frozenOverlay,
    active: {
      ...active,
      overlay: frozenOverlay,
      animationComplete: true,
      hostSettled: state.settledHostGeneration >= active.requiredHostGeneration,
      finalFrameSnapshot,
    },
    phase: 'settling' as const,
  };
  if (cancelledState.active.hostSettled) {
    return finalizeManagedTransitionState(cancelledState);
  }
  return cancelledState;
};

export const notifyManagedTransitionHostSettled = (
  state: TransitionOverlayManagerState,
  generation: number,
): TransitionOverlayManagerState => {
  if (!Number.isFinite(generation)) {
    return state;
  }
  const settledHostGeneration = Math.max(state.settledHostGeneration, generation);
  const nextState = {
    ...state,
    settledHostGeneration,
  };
  const active = nextState.active;
  if (!active || generation < active.requiredHostGeneration) {
    return nextState;
  }
  const settledActive = {
    ...active,
    hostSettled: true,
  };
  const settledState = {
    ...nextState,
    active: settledActive,
  };
  if (settledActive.animationComplete) {
    return finalizeManagedTransitionState(settledState);
  }
  return settledState;
};
