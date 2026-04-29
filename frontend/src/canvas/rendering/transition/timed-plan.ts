import { ANIMATION_CONSTANTS, type AnimationSettings } from './animation-constants';
import type {
  ChildFadeTiming,
  EdgePlan,
  NodeTiming,
  PhaseWindow,
  StructuralStepKind,
  TransitionPlanningAdvisory,
} from './sequencer/types';
import { durationForSegment, getInterSegmentPause } from './sequencer/utils';

export interface TimedTransitionPlan {
  totalDuration: number;
  basePositions: Record<string, { x: number; y: number }>;
  targetPositions: Record<string, { x: number; y: number }>;
  nodeTimings: Map<string, NodeTiming>;
  childFadeByParent: Map<string, ChildFadeTiming>;
  edgePlans: EdgePlan[];
}

export interface TimedTransitionSequence {
  totalDuration: number;
  stepWindows: Map<string, PhaseWindow>;
}

type StepChannelUsage = {
  moveX: boolean;
  moveY: boolean;
  resizeX: boolean;
  resizeY: boolean;
};

type TimedChannel = {
  key: keyof StepChannelUsage;
  duration: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const buildStepChannelUsage = (
  nodeAdvisories: TransitionPlanningAdvisory['sequence']['nodeAdvisories'],
) => {
  const usageByStepId = new Map<string, StepChannelUsage>();
  const mark = (stepId: string | undefined, key: keyof StepChannelUsage) => {
    if (!stepId) {
      return;
    }
    const usage = usageByStepId.get(stepId) ?? {
      moveX: false,
      moveY: false,
      resizeX: false,
      resizeY: false,
    };
    usage[key] = true;
    usageByStepId.set(stepId, usage);
  };

  for (const advisory of nodeAdvisories.values()) {
    mark(advisory.moveXStepId, 'moveX');
    mark(advisory.moveYStepId, 'moveY');
    mark(advisory.resizeXStepId, 'resizeX');
    mark(advisory.resizeYStepId, 'resizeY');
  }

  return usageByStepId;
};

const getOrderedTimedChannels = (
  kind: StructuralStepKind,
  usage: StepChannelUsage | undefined,
  timelineMs: AnimationSettings['timelineMs'],
): TimedChannel[] => {
  switch (kind) {
    case 'move':
      return [
        usage?.moveX ? { key: 'moveX', duration: timelineMs.right } : null,
        usage?.moveY ? { key: 'moveY', duration: timelineMs.down } : null,
      ].filter((channel): channel is TimedChannel => Boolean(channel));
    case 'shrink':
    case 'grow':
      return [
        usage?.resizeX ? { key: 'resizeX', duration: timelineMs.width } : null,
        usage?.resizeY ? { key: 'resizeY', duration: timelineMs.height } : null,
      ].filter((channel): channel is TimedChannel => Boolean(channel));
    default:
      return [];
  }
};

const getStepDuration = (
  stepId: string,
  kind: StructuralStepKind,
  stepChannelUsage: Map<string, StepChannelUsage>,
  fadeInMultiplier: number,
  timelineMs: AnimationSettings['timelineMs'],
) => {
  switch (kind) {
    case 'fadeOut':
      return durationForSegment('fade', 'out', fadeInMultiplier, timelineMs);
    case 'fadeIn':
      return durationForSegment('fade', 'in', fadeInMultiplier, timelineMs);
    case 'shrink':
    case 'grow':
    case 'move':
      return getOrderedTimedChannels(kind, stepChannelUsage.get(stepId), timelineMs).reduce(
        (sum, channel) => sum + channel.duration,
        0,
      );
    default:
      return 0;
  }
};

const resolveStepChannelWindow = (params: {
  stepId: string;
  stepKind: StructuralStepKind;
  channelKey: keyof StepChannelUsage;
  stepWindow: PhaseWindow | undefined;
  stepChannelUsage: Map<string, StepChannelUsage>;
  timelineMs: AnimationSettings['timelineMs'];
}): PhaseWindow | undefined => {
  const { stepId, stepKind, channelKey, stepWindow, stepChannelUsage, timelineMs } = params;
  if (!stepWindow) {
    return undefined;
  }
  const orderedChannels = getOrderedTimedChannels(
    stepKind,
    stepChannelUsage.get(stepId),
    timelineMs,
  );
  if (orderedChannels.length === 0) {
    return stepWindow;
  }

  const totalDuration = orderedChannels.reduce((sum, channel) => sum + channel.duration, 0);
  if (totalDuration <= 0) {
    return stepWindow;
  }

  let cursor = stepWindow.start;
  const span = stepWindow.end - stepWindow.start;
  for (const channel of orderedChannels) {
    const channelSpan = (channel.duration / totalDuration) * span;
    const window = {
      start: cursor,
      end: cursor + channelSpan,
    };
    if (channel.key === channelKey) {
      return window;
    }
    cursor = window.end;
  }

  return undefined;
};

const pickLatest = (windows: PhaseWindow[]) => {
  let selected: PhaseWindow | undefined;
  for (const window of windows) {
    if (!selected || window.start > selected.start) {
      selected = window;
    }
  }
  return selected;
};

const pickEarliest = (windows: PhaseWindow[]) => {
  let selected: PhaseWindow | undefined;
  for (const window of windows) {
    if (!selected || window.start < selected.start) {
      selected = window;
    }
  }
  return selected;
};

const getFadeWindow = (timings: Map<string, NodeTiming>, id: string, mode: 'in' | 'out') => {
  const timing = timings.get(id);
  if (!timing?.fade || timing.fadeMode !== mode) return undefined;
  return timing.fade;
};

const EDGE_REVEAL_WINDOW = 0.15;

const pickLatestStepWindow = (stepWindows: Map<string, PhaseWindow>) => {
  let selected: PhaseWindow | undefined;
  for (const window of stepWindows.values()) {
    if (!selected || window.end > selected.end) {
      selected = window;
    }
  }
  return selected;
};

const buildIncomingEdgeRevealWindow = (stepWindows: Map<string, PhaseWindow>): PhaseWindow => {
  const latestWindow = pickLatestStepWindow(stepWindows);
  const end = latestWindow?.end ?? 1;
  const start = latestWindow
    ? Math.max(latestWindow.start, end - EDGE_REVEAL_WINDOW)
    : 1 - EDGE_REVEAL_WINDOW;
  return {
    start: clamp(start, 0, 1),
    end: clamp(end, 0, 1),
  };
};

export function buildTimedTransitionSequence(params: {
  planningAdvisory: TransitionPlanningAdvisory;
  animationSettings?: AnimationSettings;
}): TimedTransitionSequence {
  const { planningAdvisory } = params;
  const animationSettings = params.animationSettings ?? ANIMATION_CONSTANTS;
  const timelineMs = animationSettings.timelineMs;
  const fadeInMultiplier = animationSettings.fadeInMultiplier;
  const interSegmentPause = getInterSegmentPause(planningAdvisory.direction, timelineMs);
  const stepChannelUsage = buildStepChannelUsage(planningAdvisory.sequence.nodeAdvisories);

  const orderedSteps = [...planningAdvisory.sequence.steps].sort(
    (left, right) => left.order - right.order,
  );
  const totalStepDuration = orderedSteps.reduce(
    (sum, step, index) =>
      sum +
      getStepDuration(step.id, step.kind, stepChannelUsage, fadeInMultiplier, timelineMs) +
      (index < orderedSteps.length - 1 ? interSegmentPause : 0),
    0,
  );
  const totalDuration = Math.max(
    1,
    totalStepDuration * animationSettings.transitionSpeedMultiplier,
  );

  const stepWindows = new Map<string, PhaseWindow>();
  let cursor = 0;
  orderedSteps.forEach((step, index) => {
    const duration = getStepDuration(
      step.id,
      step.kind,
      stepChannelUsage,
      fadeInMultiplier,
      timelineMs,
    );
    const start = totalStepDuration <= 0 ? 0 : cursor / totalStepDuration;
    cursor += duration;
    const end = totalStepDuration <= 0 ? 1 : cursor / totalStepDuration;
    stepWindows.set(step.id, {
      start: clamp(start, 0, 1),
      end: clamp(end, 0, 1),
    });
    if (index < orderedSteps.length - 1) {
      cursor += interSegmentPause;
    }
  });

  return {
    totalDuration,
    stepWindows,
  };
}

export function buildTimedTransitionPlan(params: {
  planningAdvisory: TransitionPlanningAdvisory;
  animationSettings?: AnimationSettings;
  timedSequence?: TimedTransitionSequence;
}): TimedTransitionPlan {
  const { planningAdvisory } = params;
  const timedSequence =
    params.timedSequence ??
    buildTimedTransitionSequence({
      planningAdvisory,
      animationSettings: params.animationSettings,
    });
  const animationSettings = params.animationSettings ?? ANIMATION_CONSTANTS;
  const timelineMs = animationSettings.timelineMs;
  const stepKindById = new Map(planningAdvisory.sequence.steps.map((step) => [step.id, step.kind]));
  const stepChannelUsage = buildStepChannelUsage(planningAdvisory.sequence.nodeAdvisories);

  const nodeTimings = new Map<string, NodeTiming>();
  for (const [nodeId, advisoryNode] of planningAdvisory.sequence.nodeAdvisories.entries()) {
    const timing: NodeTiming = {};
    if (advisoryNode.moveXStepId) {
      const window = resolveStepChannelWindow({
        stepId: advisoryNode.moveXStepId,
        stepKind: stepKindById.get(advisoryNode.moveXStepId) ?? 'move',
        channelKey: 'moveX',
        stepWindow: timedSequence.stepWindows.get(advisoryNode.moveXStepId),
        stepChannelUsage,
        timelineMs,
      });
      if (window) {
        timing.moveX = window;
      }
    }
    if (advisoryNode.moveYStepId) {
      const window = resolveStepChannelWindow({
        stepId: advisoryNode.moveYStepId,
        stepKind: stepKindById.get(advisoryNode.moveYStepId) ?? 'move',
        channelKey: 'moveY',
        stepWindow: timedSequence.stepWindows.get(advisoryNode.moveYStepId),
        stepChannelUsage,
        timelineMs,
      });
      if (window) {
        timing.moveY = window;
      }
    }
    if (advisoryNode.resizeXStepId) {
      const window = resolveStepChannelWindow({
        stepId: advisoryNode.resizeXStepId,
        stepKind: stepKindById.get(advisoryNode.resizeXStepId) ?? 'grow',
        channelKey: 'resizeX',
        stepWindow: timedSequence.stepWindows.get(advisoryNode.resizeXStepId),
        stepChannelUsage,
        timelineMs,
      });
      if (window) {
        timing.resizeX = window;
      }
    }
    if (advisoryNode.resizeYStepId) {
      const window = resolveStepChannelWindow({
        stepId: advisoryNode.resizeYStepId,
        stepKind: stepKindById.get(advisoryNode.resizeYStepId) ?? 'grow',
        channelKey: 'resizeY',
        stepWindow: timedSequence.stepWindows.get(advisoryNode.resizeYStepId),
        stepChannelUsage,
        timelineMs,
      });
      if (window) {
        timing.resizeY = window;
      }
    }
    if (advisoryNode.fadeStepId && advisoryNode.fadeMode) {
      const window = timedSequence.stepWindows.get(advisoryNode.fadeStepId);
      if (window) {
        timing.fade = window;
        timing.fadeMode = advisoryNode.fadeMode;
      }
    }
    if (Object.keys(timing).length > 0) {
      nodeTimings.set(nodeId, timing);
    }
  }

  const childFadeByParent = new Map<string, ChildFadeTiming>();
  for (const [parentId, childFade] of planningAdvisory.sequence.childFadeAdvisories.entries()) {
    const window = timedSequence.stepWindows.get(childFade.stepId);
    if (!window) continue;
    childFadeByParent.set(parentId, {
      window,
      mode: childFade.mode,
    });
  }

  const edgePlans: EdgePlan[] = [];
  for (const edgeDiff of planningAdvisory.structure.edgeDiffs) {
    const edgeSequence = planningAdvisory.sequence.edgeAdvisories.get(edgeDiff.id);
    const edgePlan: EdgePlan = {
      ...edgeDiff,
      hideAtStart: edgeDiff.hideAtStart,
    };
    const { fadeMode, fadeEndpointIds } = edgeSequence ?? {};
    if (fadeMode === 'in') {
      edgePlan.fade = buildIncomingEdgeRevealWindow(timedSequence.stepWindows);
      edgePlan.fadeMode = 'in';
    } else if (fadeMode === 'out' && fadeEndpointIds?.length) {
      let candidateWindows = fadeEndpointIds
        .map((id) => getFadeWindow(nodeTimings, id, fadeMode))
        .filter((window): window is PhaseWindow => Boolean(window));
      if (candidateWindows.length === 0) {
        const fallbackMode = 'in';
        candidateWindows = fadeEndpointIds
          .map((id) => getFadeWindow(nodeTimings, id, fallbackMode))
          .filter((window): window is PhaseWindow => Boolean(window));
      }
      const fadeWindow = pickEarliest(candidateWindows);
      if (fadeWindow) {
        edgePlan.fade = fadeWindow;
        edgePlan.fadeMode = fadeMode;
      }
    }
    edgePlans.push(edgePlan);
  }

  return {
    totalDuration: timedSequence.totalDuration,
    basePositions: planningAdvisory.geometry.basePositions,
    targetPositions: planningAdvisory.geometry.targetPositions,
    nodeTimings,
    childFadeByParent,
    edgePlans,
  };
}
