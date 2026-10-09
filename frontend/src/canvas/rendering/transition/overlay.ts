import type { DiagramViewNodeControls } from '@tarskia/diagram-semantics';
import { routeCanvasEdges } from '../presentation/edge-routing';
import type { CanvasEdgeGeometry, CanvasPoint, CanvasRect } from '../presentation/geometry';
import { buildBezierEdgeGeometry } from '../presentation/geometry';
import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
  CanvasPresentation,
} from '../presentation/presentation';
import type { DirectionalEdgeLabel } from '../visual/edge-labels';
import type {
  ChildFadeTiming,
  NodeControlSwitchAdvisory,
  NodeTiming,
  PhaseWindow,
  TransitionPlanningAdvisory,
} from './sequencer';
import { diagramViewNodeControlsEqual } from './sequencer';
import type { TimedTransitionPlan, TimedTransitionSequence } from './timed-plan';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const VISIBILITY_EPSILON = 0.001;
const RESIZE_SWITCH_EPSILON = 0.001;
const EDGE_ATTACHMENT_CHANGE_EXIT_WINDOW: PhaseWindow = { start: 0, end: 0.12 };
const EDGE_ATTACHMENT_CHANGE_ENTER_WINDOW: PhaseWindow = { start: 0.85, end: 1 };

const noopNodeBindings = {
  onZoomTrigger: () => false,
  onExpandDetails: () => {},
  onCollapseDetails: () => {},
  onExpandChildGroups: () => {},
  onCollapseChildGroups: () => {},
  onEdgeLabelClick: () => {},
};

type VisibleTransitionEdgeSource = Pick<
  CanvasOverlayEdgeView,
  | 'id'
  | 'relationId'
  | 'relationIds'
  | 'directionalLabels'
  | 'kind'
  | 'sourceId'
  | 'targetId'
  | 'scopeId'
  | 'label'
  | 'state'
  | 'matched'
  | 'geometry'
  | 'labelAnchor'
  | 'opacity'
  | 'solidOverNodeIds'
>;

export interface TransitionFrameNodeTrack {
  id: string;
  kind: CanvasNodeView['kind'];
  parentId?: string;
  fromView?: CanvasNodeView;
  toView?: CanvasNodeView;
  fromControls?: DiagramViewNodeControls;
  toControls?: DiagramViewNodeControls;
  controlSwitch?: {
    advisory: NodeControlSwitchAdvisory;
    appearAt?: number;
    disappearAt?: number;
    childGroupControlsAppearAt?: number;
    childGroupControlsDisappearAt?: number;
  };
  fromRect: CanvasRect;
  toRect: CanvasRect;
  fromOpacity: number;
  toOpacity: number;
  fromContentScale: number;
  toContentScale: number;
  fromChildOpacity: number;
  toChildOpacity: number;
  timing?: NodeTiming;
  childFade?: ChildFadeTiming;
}

export interface TransitionFrameLabelTrack {
  label?: string;
  state?: 'undecided' | 'none';
}

export interface TransitionFrameEdgeTrack {
  id: string;
  relationId: string;
  relationIds?: string[];
  directionalLabels?: DirectionalEdgeLabel[];
  kind: 'local' | 'routed';
  sourceId: string;
  targetId: string;
  scopeId?: string;
  solidOverNodeIds: string[];
  matched: boolean;
  lockedSides: Pick<CanvasEdgeGeometry, 'sourceSide' | 'targetSide'>;
  fromOpacity: number;
  toOpacity: number;
  fade?: PhaseWindow;
  fadeMode?: 'in' | 'out';
  labelTrack?: TransitionFrameLabelTrack;
}

export interface TransitionFrameState {
  id: number;
  startedAt: number;
  duration: number;
  nodes: TransitionFrameNodeTrack[];
  edges: TransitionFrameEdgeTrack[];
}

export interface TransitionFrameNodeFrame {
  id: string;
  kind: CanvasNodeView['kind'];
  view: CanvasNodeView;
  rect: CanvasRect;
  zIndex?: number;
  opacity: number;
  contentScale: number;
  childOpacity: number;
}

export interface TransitionFrameEdgeFrame {
  id: string;
  relationId: string;
  relationIds?: string[];
  directionalLabels?: DirectionalEdgeLabel[];
  kind: 'local' | 'routed';
  sourceId: string;
  targetId: string;
  scopeId?: string;
  label?: string;
  state?: 'undecided' | 'none';
  matched: boolean;
  opacity: number;
  geometry: CanvasEdgeGeometry;
  labelAnchor: CanvasPoint;
  solidOverNodeIds: string[];
}

export interface AnimationFrame {
  progress: number;
  nodes: TransitionFrameNodeFrame[];
  edges: TransitionFrameEdgeFrame[];
}

const EMPTY_TIMED_PLAN: TimedTransitionPlan = {
  totalDuration: 1,
  basePositions: {},
  targetPositions: {},
  nodeTimings: new Map(),
  childFadeByParent: new Map(),
  edgePlans: [],
};

const EMPTY_TIMED_SEQUENCE: TimedTransitionSequence = {
  totalDuration: 1,
  stepWindows: new Map(),
};

const EMPTY_PLANNING_ADVISORY: TransitionPlanningAdvisory = {
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

const buildVisibleEdgeMap = (edges: CanvasOverlayEdgeView[]) =>
  new Map<string, VisibleTransitionEdgeSource>(edges.map((edge) => [edge.id, edge]));

const resolveRelationId = (id: string, edge: VisibleTransitionEdgeSource | undefined) =>
  edge?.relationId ?? id.split(':')[0] ?? id;

const resolveEdgeState = (edge: VisibleTransitionEdgeSource | undefined) => edge?.state;

const edgeAttachmentChanged = (params: {
  fromEdge: VisibleTransitionEdgeSource;
  toEdge: VisibleTransitionEdgeSource;
}) => {
  const { fromEdge, toEdge } = params;
  return (
    fromEdge.sourceId !== toEdge.sourceId ||
    fromEdge.targetId !== toEdge.targetId ||
    fromEdge.geometry.sourceSide !== toEdge.geometry.sourceSide ||
    fromEdge.geometry.targetSide !== toEdge.geometry.targetSide
  );
};

const resolveAttachmentChangeFadeWindows = (
  edgePlan: {
    fade?: PhaseWindow;
    fadeMode?: 'in' | 'out';
  } | null,
) => ({
  outgoing:
    edgePlan?.fadeMode === 'out' && edgePlan.fade
      ? edgePlan.fade
      : EDGE_ATTACHMENT_CHANGE_EXIT_WINDOW,
  incoming:
    edgePlan?.fadeMode === 'in' && edgePlan.fade
      ? edgePlan.fade
      : EDGE_ATTACHMENT_CHANGE_ENTER_WINDOW,
});

const normalizeNodeView = (view: CanvasNodeView): CanvasNodeView => ({
  ...view,
});

const resolveNodeMotionProgress = (
  progress: number,
  window: PhaseWindow | undefined,
  fromValue: number,
  toValue: number,
  fallbackProgress = progress,
) => {
  if (!window) {
    return fromValue === toValue ? 1 : fallbackProgress;
  }
  const span = Math.max(window.end - window.start, Number.EPSILON);
  return clamp((progress - window.start) / span, 0, 1);
};

const controlDirectionKeys: Array<keyof DiagramViewNodeControls> = [
  'showZoomControls',
  'canZoomIn',
  'canZoomOut',
  'showDetailControls',
  'canExpandDetails',
  'canCollapseDetails',
  'showChildGroupControls',
  'canExpandChildGroups',
  'canCollapseChildGroups',
];

const resolveControlTransitionDirection = (params: {
  fromControls: DiagramViewNodeControls;
  toControls: DiagramViewNodeControls;
}) => {
  const { fromControls, toControls } = params;
  let hasAppear = false;
  let hasDisappear = false;
  for (const key of controlDirectionKeys) {
    const fromValue = Boolean(fromControls[key]);
    const toValue = Boolean(toControls[key]);
    if (!fromValue && toValue) {
      hasAppear = true;
    } else if (fromValue && !toValue) {
      hasDisappear = true;
    }
  }
  if (hasAppear && !hasDisappear) {
    return 'appear' as const;
  }
  if (hasDisappear && !hasAppear) {
    return 'disappear' as const;
  }
  return null;
};

const resolveNodeControls = (params: {
  track: TransitionFrameNodeTrack;
  progress: number;
  baseViewControls: DiagramViewNodeControls;
}) => {
  const { track, progress, baseViewControls } = params;
  const fromControls = track.fromControls ?? track.toControls;
  const toControls = track.toControls ?? track.fromControls;
  if (!fromControls || !toControls) {
    return baseViewControls;
  }
  if (diagramViewNodeControlsEqual(fromControls, toControls)) {
    return baseViewControls;
  }
  const direction = resolveControlTransitionDirection({
    fromControls,
    toControls,
  });
  const threshold =
    direction === 'disappear'
      ? (track.controlSwitch?.disappearAt ?? 0)
      : direction === 'appear'
        ? (track.controlSwitch?.appearAt ?? 1)
        : (track.controlSwitch?.appearAt ?? track.controlSwitch?.disappearAt ?? 0.5);
  const switchedControls = progress >= threshold ? toControls : fromControls;

  const childGroupDirection = resolveControlTransitionDirection({
    fromControls: {
      ...fromControls,
      showZoomControls: false,
      canZoomIn: false,
      canZoomOut: false,
      showDetailControls: false,
      canExpandDetails: false,
      canCollapseDetails: false,
    },
    toControls: {
      ...toControls,
      showZoomControls: false,
      canZoomIn: false,
      canZoomOut: false,
      showDetailControls: false,
      canExpandDetails: false,
      canCollapseDetails: false,
    },
  });
  const childGroupThreshold =
    childGroupDirection === 'disappear'
      ? (track.controlSwitch?.childGroupControlsDisappearAt ?? track.controlSwitch?.disappearAt)
      : childGroupDirection === 'appear'
        ? (track.controlSwitch?.childGroupControlsAppearAt ?? track.controlSwitch?.appearAt)
        : undefined;
  if (childGroupThreshold === undefined) {
    return switchedControls;
  }
  const childGroupControls =
    progress >= childGroupThreshold
      ? {
          showChildGroupControls: toControls.showChildGroupControls,
          canExpandChildGroups: toControls.canExpandChildGroups,
          canCollapseChildGroups: toControls.canCollapseChildGroups,
        }
      : {
          showChildGroupControls: fromControls.showChildGroupControls,
          canExpandChildGroups: fromControls.canExpandChildGroups,
          canCollapseChildGroups: fromControls.canCollapseChildGroups,
        };
  return {
    ...switchedControls,
    ...childGroupControls,
  };
};

const resolveViewSwitchProgress = (track: TransitionFrameNodeTrack) => {
  const childFadeStart = track.childFade?.window.start;
  const childFadeEnd = track.childFade?.window.end;
  const timingStarts = [
    track.timing?.moveX?.start,
    track.timing?.moveY?.start,
    track.timing?.resizeX?.start,
    track.timing?.resizeY?.start,
    track.timing?.fade?.start,
    childFadeStart,
  ].filter((value): value is number => typeof value === 'number');
  const timingEnds = [
    track.timing?.moveX?.end,
    track.timing?.moveY?.end,
    track.timing?.resizeX?.end,
    track.timing?.resizeY?.end,
    track.timing?.fade?.end,
    childFadeEnd,
  ].filter((value): value is number => typeof value === 'number');
  const grows =
    track.toRect.width > track.fromRect.width + RESIZE_SWITCH_EPSILON ||
    track.toRect.height > track.fromRect.height + RESIZE_SWITCH_EPSILON;
  const shrinks =
    track.toRect.width + RESIZE_SWITCH_EPSILON < track.fromRect.width ||
    track.toRect.height + RESIZE_SWITCH_EPSILON < track.fromRect.height;
  const fadesIn = track.toOpacity > track.fromOpacity + VISIBILITY_EPSILON;
  const fadesOut = track.toOpacity + VISIBILITY_EPSILON < track.fromOpacity;
  const revealsChildren = track.toChildOpacity > track.fromChildOpacity + VISIBILITY_EPSILON;
  const hidesChildren = track.toChildOpacity + VISIBILITY_EPSILON < track.fromChildOpacity;
  const hasTimedMotion = timingStarts.length > 0 || timingEnds.length > 0;

  if (!track.fromView) {
    return 0;
  }
  if (!track.toView) {
    return 1;
  }
  if ((shrinks || fadesOut || hidesChildren) && timingStarts.length > 0) {
    return Math.min(...timingStarts);
  }
  if ((grows || fadesIn || revealsChildren || hasTimedMotion) && timingEnds.length > 0) {
    return Math.max(...timingEnds);
  }
  return childFadeStart ?? 0.5;
};

const resolveFadeOpacity = (params: {
  progress: number;
  fade?: PhaseWindow;
  fadeMode?: 'in' | 'out';
  fromOpacity: number;
  toOpacity: number;
}) => {
  const { progress, fade, fadeMode, fromOpacity, toOpacity } = params;
  if (!fade) {
    return lerp(fromOpacity, toOpacity, progress);
  }
  const span = Math.max(fade.end - fade.start, Number.EPSILON);
  const fadeProgress = clamp((progress - fade.start) / span, 0, 1);
  if (fadeMode === 'out') {
    return lerp(fromOpacity, toOpacity, fadeProgress);
  }
  return lerp(fromOpacity, toOpacity, fadeProgress);
};

const resolveTrackGeometry = (
  edge: VisibleTransitionEdgeSource | undefined,
  fallback: CanvasEdgeGeometry | undefined,
) => edge?.geometry ?? fallback;

const collapseRectTowardAnchor = (nodeRect: CanvasRect, anchorRect: CanvasRect): CanvasRect => {
  const width = Math.max(1, Math.min(nodeRect.width, anchorRect.width) * 0.18);
  const height = Math.max(1, Math.min(nodeRect.height, anchorRect.height) * 0.18);
  const anchorCenterX = anchorRect.x + anchorRect.width / 2;
  const anchorCenterY = anchorRect.y + anchorRect.height / 2;
  return {
    x: anchorCenterX - width / 2,
    y: anchorCenterY - height / 2,
    width,
    height,
  };
};

const resolveAnchorRect = (params: {
  node: CanvasNodeView | undefined;
  anchorNodeById: Map<string, CanvasNodeView>;
  anchorRects: Map<string, CanvasRect>;
  fallbackRect: CanvasRect;
}): CanvasRect => {
  const { node, anchorNodeById, anchorRects, fallbackRect } = params;
  let parentId = node?.parentId;
  while (parentId) {
    const anchorRect = anchorRects.get(parentId);
    if (anchorRect) {
      return collapseRectTowardAnchor(fallbackRect, anchorRect);
    }
    parentId = anchorNodeById.get(parentId)?.parentId;
  }
  return fallbackRect;
};

const buildNormalizedGeometry = (params: {
  edge: VisibleTransitionEdgeSource | undefined;
  sourceRectById: Map<string, CanvasRect>;
  targetRectById: Map<string, CanvasRect>;
  sourceId: string;
  targetId: string;
  preferredSides: Pick<CanvasEdgeGeometry, 'sourceSide' | 'targetSide'>;
  fallback: CanvasEdgeGeometry;
}) => {
  const { edge, sourceRectById, targetRectById, sourceId, targetId, preferredSides, fallback } =
    params;
  const sourceRect = sourceRectById.get(sourceId);
  const targetRect = targetRectById.get(targetId);
  if (!sourceRect || !targetRect) {
    return edge?.geometry ?? fallback;
  }
  return buildBezierEdgeGeometry({
    sourceRect,
    targetRect,
    sourceSide: preferredSides.sourceSide,
    targetSide: preferredSides.targetSide,
  });
};

const resolveSequenceProgress = (state: TransitionFrameState, now: number) =>
  clamp((now - state.startedAt) / Math.max(state.duration, 1), 0, 1);

const resolveNodeRect = (track: TransitionFrameNodeTrack, progress: number): CanvasRect => {
  const hasGeometryTiming = Boolean(
    track.timing?.moveX || track.timing?.moveY || track.timing?.resizeX || track.timing?.resizeY,
  );
  const geometryFallbackProgress =
    !hasGeometryTiming && track.timing?.fadeMode === 'in'
      ? 1
      : !hasGeometryTiming && track.timing?.fadeMode === 'out'
        ? 0
        : progress;
  const moveX = resolveNodeMotionProgress(
    progress,
    track.timing?.moveX,
    track.fromRect.x,
    track.toRect.x,
    geometryFallbackProgress,
  );
  const moveY = resolveNodeMotionProgress(
    progress,
    track.timing?.moveY,
    track.fromRect.y,
    track.toRect.y,
    geometryFallbackProgress,
  );
  const resizeX = resolveNodeMotionProgress(
    progress,
    track.timing?.resizeX,
    track.fromRect.width,
    track.toRect.width,
    geometryFallbackProgress,
  );
  const resizeY = resolveNodeMotionProgress(
    progress,
    track.timing?.resizeY,
    track.fromRect.height,
    track.toRect.height,
    geometryFallbackProgress,
  );
  return {
    x: lerp(track.fromRect.x, track.toRect.x, moveX),
    y: lerp(track.fromRect.y, track.toRect.y, moveY),
    width: lerp(track.fromRect.width, track.toRect.width, resizeX),
    height: lerp(track.fromRect.height, track.toRect.height, resizeY),
  };
};

const resolveNodeFrame = (track: TransitionFrameNodeTrack, progress: number) => {
  const rect = resolveNodeRect(track, progress);
  const opacity = resolveFadeOpacity({
    progress,
    fade: track.timing?.fade,
    fadeMode: track.timing?.fadeMode,
    fromOpacity: track.fromOpacity,
    toOpacity: track.toOpacity,
  });
  const childOpacity = track.childFade
    ? resolveFadeOpacity({
        progress,
        fade: track.childFade.window,
        fadeMode: track.childFade.mode,
        fromOpacity: track.fromChildOpacity,
        toOpacity: track.toChildOpacity,
      })
    : lerp(track.fromChildOpacity, track.toChildOpacity, progress);
  const viewSwitchProgress = resolveViewSwitchProgress(track);
  const view =
    (progress >= viewSwitchProgress
      ? (track.toView ?? track.fromView)
      : (track.fromView ?? track.toView)) ??
    track.toView ??
    track.fromView;
  if (!view) {
    throw new Error(`Missing overlay view for node ${track.id}`);
  }
  const zIndex = Math.max(track.fromView?.zIndex ?? 0, track.toView?.zIndex ?? 0) || undefined;
  const controls = resolveNodeControls({
    track,
    progress,
    baseViewControls: view.controls,
  });
  return {
    id: track.id,
    kind: track.kind,
    view: {
      ...view,
      zIndex: zIndex ?? view.zIndex,
      controls,
    },
    rect,
    zIndex,
    opacity,
    contentScale: lerp(track.fromContentScale, track.toContentScale, progress),
    childOpacity,
  } satisfies TransitionFrameNodeFrame;
};

const resolveEdgeFrame = (
  track: TransitionFrameEdgeTrack,
  progress: number,
  rectByNodeId: Map<string, CanvasRect>,
) => {
  // The caller includes only edges whose two node rects are visible this frame.
  // Seed geometry from those same rects; the shared router then assigns lanes and anchors.
  const geometry = buildBezierEdgeGeometry({
    sourceRect: rectByNodeId.get(track.sourceId)!,
    targetRect: rectByNodeId.get(track.targetId)!,
    sourceSide: track.lockedSides.sourceSide,
    targetSide: track.lockedSides.targetSide,
  });
  const opacity = resolveFadeOpacity({
    progress,
    fade: track.fade,
    fadeMode: track.fadeMode,
    fromOpacity: track.fromOpacity,
    toOpacity: track.toOpacity,
  });
  return {
    id: track.id,
    relationId: track.relationId,
    relationIds: track.relationIds,
    directionalLabels: track.directionalLabels,
    kind: track.kind,
    sourceId: track.sourceId,
    targetId: track.targetId,
    scopeId: track.scopeId,
    label: track.labelTrack?.label,
    state: track.labelTrack?.state,
    matched: track.matched,
    opacity,
    geometry,
    labelAnchor: geometry.labelAnchor,
    solidOverNodeIds: track.solidOverNodeIds,
  } satisfies TransitionFrameEdgeFrame;
};

export const resolveAnimationFrame = (state: TransitionFrameState, now: number): AnimationFrame => {
  const progress = resolveSequenceProgress(state, now);
  const rawNodeById = new Map<string, TransitionFrameNodeFrame>();
  for (const track of state.nodes) {
    rawNodeById.set(track.id, resolveNodeFrame(track, progress));
  }

  const nodes: TransitionFrameNodeFrame[] = [];
  const rectByNodeId = new Map<string, CanvasRect>();
  for (const track of state.nodes) {
    const rawNode = rawNodeById.get(track.id);
    if (!rawNode) continue;
    const node = rawNode;
    if (
      node.opacity <= VISIBILITY_EPSILON ||
      node.rect.width <= VISIBILITY_EPSILON ||
      node.rect.height <= VISIBILITY_EPSILON
    ) {
      continue;
    }
    nodes.push(node);
    rectByNodeId.set(node.id, node.rect);
  }

  const edges: TransitionFrameEdgeFrame[] = [];
  for (const track of state.edges) {
    if (!rectByNodeId.has(track.sourceId) || !rectByNodeId.has(track.targetId)) {
      continue;
    }
    const edge = resolveEdgeFrame(track, progress, rectByNodeId);
    if (edge.opacity <= VISIBILITY_EPSILON) {
      continue;
    }
    edges.push(edge);
  }

  return {
    progress,
    nodes,
    edges: routeCanvasEdges(
      nodes.map((node) => ({ ...node.view, rect: node.rect })),
      edges,
    ),
  };
};

export const buildTransitionFrameState = (params: {
  id: number;
  startedAt: number;
  duration: number;
  sharedNodeGeometry?: 'freeze-from';
  planningAdvisory: TransitionPlanningAdvisory;
  timedPlan: TimedTransitionPlan;
  timedSequence: TimedTransitionSequence;
  fromPresentation: CanvasPresentation;
  toPresentation: CanvasPresentation;
}) => {
  const {
    id,
    startedAt,
    duration,
    planningAdvisory,
    timedPlan,
    timedSequence,
    fromPresentation,
    toPresentation,
    sharedNodeGeometry,
  } = params;
  const fromNodeById = new Map(fromPresentation.nodes.map((node) => [node.id, node]));
  const toNodeById = new Map(toPresentation.nodes.map((node) => [node.id, node]));
  const fromNodeRects = new Map(fromPresentation.nodes.map((node) => [node.id, node.rect]));
  const toNodeRects = new Map(toPresentation.nodes.map((node) => [node.id, node.rect]));
  const nodeIds = new Set([...fromNodeById.keys(), ...toNodeById.keys()]);
  const nodes: TransitionFrameNodeTrack[] = [...nodeIds].flatMap((nodeId) => {
    const fromNode = fromNodeById.get(nodeId);
    const toNode = toNodeById.get(nodeId);
    if (!fromNode && !toNode) return [];
    const baseNode = toNode ?? fromNode;
    if (!baseNode) return [];
    const fromView = fromNode ? normalizeNodeView(fromNode) : undefined;
    const toView = toNode ? normalizeNodeView(toNode) : undefined;
    const freezeSharedGeometry =
      sharedNodeGeometry === 'freeze-from' && Boolean(fromNode && toNode);
    const controlSwitchAdvisory = planningAdvisory.sequence.controlSwitchAdvisories.get(nodeId);
    const fromRect =
      fromNode?.rect ??
      resolveAnchorRect({
        node: toNode,
        anchorNodeById: fromNodeById,
        anchorRects: fromNodeRects,
        fallbackRect: toNode?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      });
    const toRect = freezeSharedGeometry
      ? fromRect
      : (toNode?.rect ??
        resolveAnchorRect({
          node: fromNode,
          anchorNodeById: toNodeById,
          anchorRects: toNodeRects,
          fallbackRect: fromNode?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
        }));
    return [
      {
        id: nodeId,
        kind: (toView ?? fromView)?.kind ?? 'entity',
        parentId: (toView ?? fromView)?.parentId,
        fromView,
        toView,
        fromControls: fromView?.controls,
        toControls: toView?.controls,
        controlSwitch: controlSwitchAdvisory
          ? {
              advisory: controlSwitchAdvisory,
              appearAt: controlSwitchAdvisory.appearAtStepId
                ? timedSequence.stepWindows.get(controlSwitchAdvisory.appearAtStepId)?.end
                : undefined,
              disappearAt: controlSwitchAdvisory.disappearAtStepId
                ? timedSequence.stepWindows.get(controlSwitchAdvisory.disappearAtStepId)?.start
                : undefined,
              childGroupControlsAppearAt: controlSwitchAdvisory.childGroupControlsAppearAtStepId
                ? timedSequence.stepWindows.get(
                    controlSwitchAdvisory.childGroupControlsAppearAtStepId,
                  )?.end
                : undefined,
              childGroupControlsDisappearAt:
                controlSwitchAdvisory.childGroupControlsDisappearAtStepId
                  ? timedSequence.stepWindows.get(
                      controlSwitchAdvisory.childGroupControlsDisappearAtStepId,
                    )?.start
                  : undefined,
            }
          : undefined,
        fromRect,
        toRect,
        fromOpacity: fromNode?.opacity ?? 0,
        toOpacity: toNode?.opacity ?? 0,
        fromContentScale: fromNode?.contentScale ?? 0.94,
        toContentScale: toNode?.contentScale ?? 1,
        fromChildOpacity: fromNode?.content.childOpacity ?? 1,
        toChildOpacity: toNode?.content.childOpacity ?? 1,
        timing: timedPlan.nodeTimings.get(nodeId),
        childFade: timedPlan.childFadeByParent.get(nodeId),
      } satisfies TransitionFrameNodeTrack,
    ];
  });

  const fromVisibleEdgeById = buildVisibleEdgeMap(fromPresentation.overlayEdges);
  const toVisibleEdgeById = buildVisibleEdgeMap(toPresentation.overlayEdges);

  const buildEdgeTracks = (
    id: string,
    fromEdge: VisibleTransitionEdgeSource | undefined,
    toEdge: VisibleTransitionEdgeSource | undefined,
  ): TransitionFrameEdgeTrack[] => {
    if (!fromEdge && !toEdge) return [];
    const kind = toEdge?.kind ?? fromEdge?.kind;
    if (!kind) return [];
    const edgePlan = timedPlan.edgePlans.find((plan) => plan.id === id) ?? null;
    const relationId = resolveRelationId(id, toEdge ?? fromEdge);
    const edgeState = resolveEdgeState(toEdge ?? fromEdge);
    const label = toEdge?.label ?? fromEdge?.label;
    const matched = toEdge?.matched ?? fromEdge?.matched ?? false;
    const sourceId = toEdge?.sourceId ?? fromEdge?.sourceId;
    const targetId = toEdge?.targetId ?? fromEdge?.targetId;
    const scopeId = toEdge?.scopeId ?? fromEdge?.scopeId;
    const solidOverNodeIds = toEdge?.solidOverNodeIds ?? fromEdge?.solidOverNodeIds ?? [];
    if (!sourceId || !targetId) return [];
    const fallbackGeometry =
      resolveTrackGeometry(toEdge, fromEdge?.geometry) ??
      resolveTrackGeometry(fromEdge, toEdge?.geometry);
    if (!fallbackGeometry) return [];
    const preferredSides = toEdge?.geometry ?? fromEdge?.geometry ?? fallbackGeometry;
    const normalizedFromGeometry = buildNormalizedGeometry({
      edge: fromEdge,
      sourceRectById: fromNodeRects,
      targetRectById: fromNodeRects,
      sourceId,
      targetId,
      preferredSides,
      fallback: fallbackGeometry,
    });
    const normalizedToGeometry = buildNormalizedGeometry({
      edge: toEdge,
      sourceRectById: toNodeRects,
      targetRectById: toNodeRects,
      sourceId,
      targetId,
      preferredSides,
      fallback: fallbackGeometry,
    });
    const buildTrack = (params: {
      trackId: string;
      metadataEdge?: VisibleTransitionEdgeSource;
      kind: 'local' | 'routed';
      sourceId: string;
      targetId: string;
      scopeId?: string;
      solidOverNodeIds: string[];
      lockedSides: Pick<CanvasEdgeGeometry, 'sourceSide' | 'targetSide'>;
      fromOpacity: number;
      toOpacity: number;
      fade?: PhaseWindow;
      fadeMode?: 'in' | 'out';
    }) =>
      ({
        id: params.trackId,
        relationId,
        relationIds: (params.metadataEdge ?? toEdge ?? fromEdge)?.relationIds,
        directionalLabels: (params.metadataEdge ?? toEdge ?? fromEdge)?.directionalLabels,
        kind: params.kind,
        sourceId: params.sourceId,
        targetId: params.targetId,
        scopeId: params.scopeId,
        solidOverNodeIds: params.solidOverNodeIds,
        matched,
        lockedSides: params.lockedSides,
        fromOpacity: params.fromOpacity,
        toOpacity: params.toOpacity,
        fade: params.fade,
        fadeMode: params.fadeMode,
        labelTrack: params.metadataEdge
          ? { label: params.metadataEdge.label, state: params.metadataEdge.state }
          : label !== undefined || edgeState !== undefined
            ? { label, state: edgeState }
            : undefined,
      }) satisfies TransitionFrameEdgeTrack;

    if (fromEdge && toEdge && edgeAttachmentChanged({ fromEdge, toEdge })) {
      const fadeWindows = resolveAttachmentChangeFadeWindows(edgePlan);
      return [
        buildTrack({
          trackId: `${id}::out`,
          metadataEdge: fromEdge,
          kind: fromEdge.kind,
          sourceId: fromEdge.sourceId,
          targetId: fromEdge.targetId,
          scopeId: fromEdge.scopeId,
          solidOverNodeIds: fromEdge.solidOverNodeIds,
          lockedSides: {
            sourceSide: normalizedFromGeometry.sourceSide,
            targetSide: normalizedFromGeometry.targetSide,
          },
          fromOpacity: fromEdge.opacity,
          toOpacity: 0,
          fade: fadeWindows.outgoing,
          fadeMode: 'out',
        }),
        buildTrack({
          trackId: `${id}::in`,
          metadataEdge: toEdge,
          kind: toEdge.kind,
          sourceId: toEdge.sourceId,
          targetId: toEdge.targetId,
          scopeId: toEdge.scopeId,
          solidOverNodeIds: toEdge.solidOverNodeIds,
          lockedSides: {
            sourceSide: normalizedToGeometry.sourceSide,
            targetSide: normalizedToGeometry.targetSide,
          },
          fromOpacity: 0,
          toOpacity: toEdge.opacity,
          fade: fadeWindows.incoming,
          fadeMode: 'in',
        }),
      ];
    }

    return [
      buildTrack({
        trackId: id,
        kind,
        sourceId,
        targetId,
        scopeId,
        solidOverNodeIds,
        lockedSides: toEdge
          ? {
              sourceSide: normalizedToGeometry.sourceSide,
              targetSide: normalizedToGeometry.targetSide,
            }
          : {
              sourceSide: normalizedFromGeometry.sourceSide,
              targetSide: normalizedFromGeometry.targetSide,
            },
        fromOpacity: fromEdge?.opacity ?? 0,
        toOpacity: toEdge?.opacity ?? 0,
        fade: edgePlan?.fade,
        fadeMode: edgePlan?.fadeMode,
      }),
    ];
  };

  const visibleEdgeIds = new Set([...fromVisibleEdgeById.keys(), ...toVisibleEdgeById.keys()]);
  const edges: TransitionFrameEdgeTrack[] = [];
  for (const edgeId of visibleEdgeIds) {
    edges.push(
      ...buildEdgeTracks(edgeId, fromVisibleEdgeById.get(edgeId), toVisibleEdgeById.get(edgeId)),
    );
  }

  return {
    id,
    startedAt,
    duration,
    nodes,
    edges,
  } satisfies TransitionFrameState;
};

export const overlayNodeBindings = noopNodeBindings;

export const captureTransitionFrameSnapshot = (params: {
  state: TransitionFrameState;
  frame: AnimationFrame;
}): CanvasPresentation => {
  const { frame } = params;
  const nodesById = new Map<string, CanvasNodeView>();

  for (const node of frame.nodes) {
    nodesById.set(node.id, {
      ...node.view,
      rect: node.rect,
      zIndex: node.zIndex ?? node.view.zIndex,
      opacity: node.opacity,
      contentScale: node.contentScale,
      content: {
        ...node.view.content,
        childOpacity: node.childOpacity,
      },
    });
  }

  const overlayEdges: CanvasOverlayEdgeView[] = frame.edges.map((edge) => ({
    id: edge.id,
    relationId: edge.relationId,
    relationIds: edge.relationIds,
    directionalLabels: edge.directionalLabels,
    kind: edge.kind,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    scopeId: edge.scopeId,
    label: edge.label,
    state: edge.state,
    matched: edge.matched,
    geometry: edge.geometry,
    path: edge.geometry.path,
    labelAnchor: edge.labelAnchor,
    opacity: edge.opacity,
    solidOverNodeIds: edge.solidOverNodeIds,
  }));

  return {
    nodes: [...nodesById.values()],
    overlayEdges,
  };
};

export const buildStaticTransitionFrameState = (params: {
  snapshot: CanvasPresentation;
  id: number;
  startedAt: number;
}): TransitionFrameState =>
  buildTransitionFrameState({
    id: params.id,
    startedAt: params.startedAt,
    duration: 1,
    planningAdvisory: EMPTY_PLANNING_ADVISORY,
    timedPlan: EMPTY_TIMED_PLAN,
    timedSequence: EMPTY_TIMED_SEQUENCE,
    fromPresentation: params.snapshot,
    toPresentation: params.snapshot,
  });
