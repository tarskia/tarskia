import { describe, expect, it } from 'vitest';

import type { CanvasRenderSnapshot } from './rendering/presentation/presentation';
import { resolveAnimationFrame } from './rendering/transition/overlay';
import type { TransitionPlanningAdvisory } from './rendering/transition/sequencer';
import type {
  TimedTransitionPlan,
  TimedTransitionSequence,
} from './rendering/transition/timed-plan';
import {
  advanceManagedTransitionState,
  createTransitionFrameManagerState,
  startManagedTransitionState,
  syncTransitionFrameManagerStableSnapshot,
} from './useTransitionFrameManager';

const timedPlan: TimedTransitionPlan = {
  totalDuration: 100,
  basePositions: {},
  targetPositions: {},
  nodeTimings: new Map(),
  childFadeByParent: new Map(),
  edgePlans: [],
};

const timedSequence: TimedTransitionSequence = {
  totalDuration: 100,
  stepWindows: new Map(),
};

const planningAdvisory: TransitionPlanningAdvisory = {
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
};

const buildSnapshot = (x: number): CanvasRenderSnapshot => ({
  nodes: [
    {
      id: 'node-1',
      kind: 'entity',
      matched: false,
      rect: { x, y: 0, width: 120, height: 64 },
      opacity: 1,
      contentScale: 1,
      content: {
        label: `Node ${x}`,
        entityType: 'Type',
        badges: [],
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

describe('transition frame manager state', () => {
  it('starts transitions from the outgoing snapshot', () => {
    const next = buildSnapshot(100);
    const state = startManagedTransitionState(createTransitionFrameManagerState(buildSnapshot(0)), {
      incomingSnapshot: next,
      planningAdvisory,
      timedPlan,
      timedSequence,
      duration: 100,
      now: 0,
    });

    expect(state.phase).toBe('animating');
    expect(state.hostSnapshot.nodes[0]?.rect.x).toBe(0);
    expect(state.transitionFrame).not.toBeNull();
  });

  it('commits the target immediately when animation completes', () => {
    const next = buildSnapshot(100);
    const started = startManagedTransitionState(
      createTransitionFrameManagerState(buildSnapshot(0)),
      {
        incomingSnapshot: next,
        planningAdvisory,
        timedPlan,
        timedSequence,
        duration: 100,
        now: 0,
      },
    );
    const completed = advanceManagedTransitionState(started, 100);
    expect(completed.animationCompleted).toBe(true);
    expect(completed.state.phase).toBe('idle');
    expect(completed.state.transitionFrame).toBeNull();
    expect(completed.state.hostSnapshot).toBe(next);
    expect(completed.state.committedSnapshot).toBe(next);
  });

  it('restarts interrupted transitions from the currently displayed frame rather than the prior target endpoint', () => {
    const midpointTarget = buildSnapshot(100);
    const finalTarget = buildSnapshot(200);
    const started = startManagedTransitionState(
      createTransitionFrameManagerState(buildSnapshot(0)),
      {
        incomingSnapshot: midpointTarget,
        planningAdvisory,
        timedPlan,
        timedSequence,
        duration: 100,
        now: 0,
      },
    );
    const midflight = advanceManagedTransitionState(started, 50).state;
    const activeOverlay = midflight.active?.overlay;
    expect(activeOverlay).toBeDefined();
    if (!activeOverlay) {
      throw new Error('Expected midflight transition to retain an active overlay');
    }
    const capturedFrame = resolveAnimationFrame(activeOverlay, 50);

    const interrupted = startManagedTransitionState(midflight, {
      incomingSnapshot: finalTarget,
      planningAdvisory,
      timedPlan,
      timedSequence,
      duration: 100,
      now: 50,
    });

    expect(interrupted.hostSnapshot.nodes[0]?.rect.x).toBe(capturedFrame.nodes[0]?.rect.x);
    expect(interrupted.transitionFrame?.nodes[0]?.fromRect.x).toBe(capturedFrame.nodes[0]?.rect.x);
  });

  it('retains the same immutable snapshot when synchronizing stable state', () => {
    const original = buildSnapshot(0);
    const state = createTransitionFrameManagerState(original);
    const synced = syncTransitionFrameManagerStableSnapshot(state, original);

    expect(synced.hostSnapshot).toBe(original);
    expect(synced.committedSnapshot).toBe(original);
  });
});
