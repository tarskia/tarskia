import type { CanvasRenderSnapshot } from './rendering/presentation/presentation';
import {
  buildTransitionFrameState,
  captureTransitionFrameSnapshot,
  resolveAnimationFrame,
  type TransitionFrameState,
} from './rendering/transition/overlay';
import type { TransitionPlanningAdvisory } from './rendering/transition/sequencer';
import type {
  TimedTransitionPlan,
  TimedTransitionSequence,
} from './rendering/transition/timed-plan';

export type ManagerPhase = 'idle' | 'animating' | 'settling';

export interface ManagedTransitionState {
  outgoingSnapshot: CanvasRenderSnapshot;
  incomingSnapshot: CanvasRenderSnapshot;
  overlay: TransitionFrameState;
  startedAt: number;
  duration: number;
}

export interface TransitionFrameManagerState {
  committedSnapshot: CanvasRenderSnapshot;
  hostSnapshot: CanvasRenderSnapshot;
  transitionFrame: TransitionFrameState | null;
  active: ManagedTransitionState | null;
  phase: ManagerPhase;
}

export interface StartManagedTransitionArgs {
  incomingSnapshot: CanvasRenderSnapshot;
  planningAdvisory: TransitionPlanningAdvisory;
  timedPlan: TimedTransitionPlan;
  timedSequence: TimedTransitionSequence;
  duration: number;
  sharedNodeGeometry?: 'freeze-from';
}

const finalizeManagedTransitionState = (
  state: TransitionFrameManagerState,
): TransitionFrameManagerState => {
  const active = state.active;
  if (!active) {
    return state;
  }
  return {
    ...state,
    committedSnapshot: active.incomingSnapshot,
    hostSnapshot: active.incomingSnapshot,
    transitionFrame: null,
    active: null,
    phase: 'idle',
  };
};

const captureManagedTransitionSnapshot = (active: ManagedTransitionState, now: number) =>
  captureTransitionFrameSnapshot({
    state: active.overlay,
    frame: resolveAnimationFrame(active.overlay, now),
  });

export const createTransitionFrameManagerState = (
  stableSnapshot: CanvasRenderSnapshot,
): TransitionFrameManagerState => ({
  committedSnapshot: stableSnapshot,
  hostSnapshot: stableSnapshot,
  transitionFrame: null,
  active: null,
  phase: 'idle',
});

export const syncTransitionFrameManagerStableSnapshot = (
  state: TransitionFrameManagerState,
  stableSnapshot: CanvasRenderSnapshot,
): TransitionFrameManagerState => {
  if (state.active) {
    return state;
  }
  return {
    ...state,
    committedSnapshot: stableSnapshot,
    hostSnapshot: stableSnapshot,
    transitionFrame: null,
    phase: 'idle',
  };
};

export const startManagedTransitionState = (
  state: TransitionFrameManagerState,
  args: StartManagedTransitionArgs & { now: number },
): TransitionFrameManagerState => {
  const {
    incomingSnapshot,
    planningAdvisory,
    timedPlan,
    timedSequence,
    duration,
    sharedNodeGeometry,
    now,
  } = args;
  const outgoingSnapshot = state.active
    ? captureManagedTransitionSnapshot(state.active, now)
    : state.committedSnapshot;
  const overlay = buildTransitionFrameState({
    id: now,
    startedAt: now,
    duration,
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
    transitionFrame: overlay,
    active: {
      outgoingSnapshot,
      incomingSnapshot,
      overlay,
      startedAt: now,
      duration,
    },
    phase: 'animating',
  };
};

export const advanceManagedTransitionState = (
  state: TransitionFrameManagerState,
  now: number,
): { state: TransitionFrameManagerState; animationCompleted: boolean } => {
  const active = state.active;
  if (!active || now < active.startedAt + active.duration)
    return { state, animationCompleted: false };
  return { state: finalizeManagedTransitionState(state), animationCompleted: true };
};
