import { describe, expect, it } from 'vitest';

import type { CanvasRenderSnapshot } from './rendering/presentation/presentation';
import { resolveTransitionOverlayFrame } from './rendering/transition/overlay';
import type { TransitionPlanningAdvisory } from './rendering/transition/sequencer';
import type {
  TimedTransitionPlan,
  TimedTransitionSequence,
} from './rendering/transition/timed-plan';
import {
  advanceManagedTransitionState,
  cancelManagedTransitionState,
  createTransitionOverlayManagerState,
  notifyManagedTransitionHostSettled,
  startManagedTransitionState,
  syncTransitionOverlayManagerStableSnapshot,
} from './useTransitionOverlayManager';

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

describe('transition overlay manager state', () => {
  it('starts transitions by hiding the host and keeping the outgoing host snapshot until settle', () => {
    const next = buildSnapshot(100);
    const state = startManagedTransitionState(
      createTransitionOverlayManagerState(buildSnapshot(0)),
      {
        incomingSnapshot: next,
        planningAdvisory,
        timedPlan,
        timedSequence,
        duration: 100,
        now: 0,
      },
    );

    expect(state.phase).toBe('animating');
    expect(state.requiredHostGeneration).toBe(1);
    expect(state.hostSnapshot.nodes[0]?.rect.x).toBe(0);
    expect(state.transitionOverlay).not.toBeNull();
  });

  it('keeps the overlay visible after animation completion until the required host generation settles', () => {
    const next = buildSnapshot(100);
    const started = startManagedTransitionState(
      createTransitionOverlayManagerState(buildSnapshot(0)),
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
    expect(completed.state.phase).toBe('settling');
    expect(completed.state.hostSnapshot.nodes[0]?.rect.x).toBe(100);
    expect(completed.state.transitionOverlay).not.toBeNull();

    const settled = notifyManagedTransitionHostSettled(completed.state, 1);
    expect(settled.phase).toBe('idle');
    expect(settled.transitionOverlay).toBeNull();
    expect(settled.hostSnapshot.nodes[0]?.rect.x).toBe(100);
  });

  it('reveals the host immediately when the required generation has already settled by animation completion', () => {
    const next = buildSnapshot(100);
    const started = startManagedTransitionState(
      createTransitionOverlayManagerState(buildSnapshot(0)),
      {
        incomingSnapshot: next,
        planningAdvisory,
        timedPlan,
        timedSequence,
        duration: 100,
        now: 0,
      },
    );
    const preSettled = notifyManagedTransitionHostSettled(started, 1);

    const completed = advanceManagedTransitionState(preSettled, 100);
    expect(completed.state.phase).toBe('idle');
    expect(completed.state.transitionOverlay).toBeNull();
    expect(completed.state.hostSnapshot.nodes[0]?.rect.x).toBe(100);
  });

  it('restarts interrupted transitions from the currently displayed frame rather than the prior target endpoint', () => {
    const midpointTarget = buildSnapshot(100);
    const finalTarget = buildSnapshot(200);
    const started = startManagedTransitionState(
      createTransitionOverlayManagerState(buildSnapshot(0)),
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
    const capturedFrame = resolveTransitionOverlayFrame(activeOverlay, 50);

    const interrupted = startManagedTransitionState(midflight, {
      incomingSnapshot: finalTarget,
      planningAdvisory,
      timedPlan,
      timedSequence,
      duration: 100,
      now: 50,
    });

    expect(interrupted.hostSnapshot.nodes[0]?.rect.x).toBe(capturedFrame.nodes[0]?.rect.x);
    expect(interrupted.transitionOverlay?.nodes[0]?.fromRect.x).toBe(
      capturedFrame.nodes[0]?.rect.x,
    );
  });

  it('cancels transitions without revealing a stale committed snapshot', () => {
    const next = buildSnapshot(100);
    const started = startManagedTransitionState(
      createTransitionOverlayManagerState(buildSnapshot(0)),
      {
        incomingSnapshot: next,
        planningAdvisory,
        timedPlan,
        timedSequence,
        duration: 100,
        now: 0,
      },
    );
    const midflight = advanceManagedTransitionState(started, 40).state;

    const cancelled = cancelManagedTransitionState(midflight, 40);
    expect(cancelled.phase).toBe('settling');
    expect(cancelled.hostSnapshot.nodes[0]?.rect.x).toBe(100);

    const settled = notifyManagedTransitionHostSettled(cancelled, 1);
    expect(settled.phase).toBe('idle');
    expect(settled.transitionOverlay).toBeNull();
    expect(settled.hostSnapshot.nodes[0]?.rect.x).toBe(100);
  });

  it('treats semantically identical stable snapshots as unchanged', () => {
    const original = buildSnapshot(0);
    const semanticallyEqualClone = {
      ...buildSnapshot(0),
      nodes: buildSnapshot(0).nodes.map((node) => ({
        ...node,
        rect: { ...node.rect },
        controls: { ...node.controls },
        capabilities: { ...node.capabilities },
      })),
      overlayEdges: [],
    } satisfies CanvasRenderSnapshot;

    const state = createTransitionOverlayManagerState(original);
    const synced = syncTransitionOverlayManagerStableSnapshot(state, semanticallyEqualClone);

    expect(synced).toBe(state);
  });
});
