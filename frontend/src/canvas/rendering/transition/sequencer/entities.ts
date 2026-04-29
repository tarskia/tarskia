import { buildEdgeSequenceAdvisories } from './edges';
import type {
  NodeControlSwitchAdvisory,
  SequencedTransitionAdvisory,
  StructuralChildFadeAdvisory,
  StructuralNodeAdvisory,
  StructuralStepKind,
  StructuralTransitionDiff,
  TransitionGeometryAdvisory,
} from './types';

const buildInternalSegmentOrder = (direction: 'in' | 'out'): StructuralStepKind[] =>
  direction === 'out'
    ? ['fadeOut', 'shrink', 'move', 'grow']
    : ['shrink', 'move', 'grow', 'fadeIn'];

const pickEarlierStepId = (
  stepIds: Array<string | undefined>,
  stepOrderById: Map<string, number>,
) => {
  let selected: string | undefined;
  for (const stepId of stepIds) {
    if (!stepId) continue;
    if (
      !selected ||
      (stepOrderById.get(stepId) ?? Infinity) < (stepOrderById.get(selected) ?? Infinity)
    ) {
      selected = stepId;
    }
  }
  return selected;
};

const pickLaterStepId = (
  stepIds: Array<string | undefined>,
  stepOrderById: Map<string, number>,
) => {
  let selected: string | undefined;
  for (const stepId of stepIds) {
    if (!stepId) continue;
    if (
      !selected ||
      (stepOrderById.get(stepId) ?? -Infinity) > (stepOrderById.get(selected) ?? -Infinity)
    ) {
      selected = stepId;
    }
  }
  return selected;
};

const getGeometryAffectingStepIds = (advisory: StructuralNodeAdvisory | undefined) =>
  [
    advisory?.moveXStepId,
    advisory?.moveYStepId,
    advisory?.resizeXStepId,
    advisory?.resizeYStepId,
    advisory?.fadeStepId,
  ].filter((stepId): stepId is string => Boolean(stepId));

const buildNodeControlSwitchAdvisory = (params: {
  nodeId: string;
  nodeAdvisories: Map<string, StructuralNodeAdvisory>;
  childFadeAdvisories: Map<string, StructuralChildFadeAdvisory>;
  stepOrderById: Map<string, number>;
}): NodeControlSwitchAdvisory | null => {
  const { nodeId, nodeAdvisories, childFadeAdvisories, stepOrderById } = params;
  const nodeAdvisory = nodeAdvisories.get(nodeId);
  const childFade = childFadeAdvisories.get(nodeId);
  const geometryStepIds = getGeometryAffectingStepIds(nodeAdvisory);

  const appearAtStepId = pickLaterStepId(
    [
      nodeAdvisory?.resizeYStepId && geometryStepIds.includes(nodeAdvisory.resizeYStepId)
        ? nodeAdvisory.resizeYStepId
        : undefined,
      childFade?.mode === 'in' ? childFade.stepId : undefined,
      nodeAdvisory?.fadeMode === 'in' ? nodeAdvisory.fadeStepId : undefined,
      pickLaterStepId(geometryStepIds, stepOrderById),
    ],
    stepOrderById,
  );
  const disappearAtStepId = pickEarlierStepId(
    [
      nodeAdvisory?.resizeYStepId && geometryStepIds.includes(nodeAdvisory.resizeYStepId)
        ? nodeAdvisory.resizeYStepId
        : undefined,
      childFade?.mode === 'out' ? childFade.stepId : undefined,
      nodeAdvisory?.fadeMode === 'out' ? nodeAdvisory.fadeStepId : undefined,
      pickEarlierStepId(geometryStepIds, stepOrderById),
    ],
    stepOrderById,
  );
  const childGroupControlsAppearAtStepId =
    childFade?.mode === 'in' ? childFade.stepId : appearAtStepId;
  const childGroupControlsDisappearAtStepId =
    childFade?.mode === 'out' ? childFade.stepId : disappearAtStepId;

  if (
    !appearAtStepId &&
    !disappearAtStepId &&
    !childGroupControlsAppearAtStepId &&
    !childGroupControlsDisappearAtStepId
  ) {
    return null;
  }
  return {
    id: nodeId,
    appearAtStepId,
    disappearAtStepId,
    childGroupControlsAppearAtStepId,
    childGroupControlsDisappearAtStepId,
  };
};

export function buildSequencedTransitionAdvisory(params: {
  direction: 'in' | 'out';
  structure: StructuralTransitionDiff;
  geometry: TransitionGeometryAdvisory;
}): SequencedTransitionAdvisory {
  const { direction, structure, geometry } = params;

  const activeSegmentsByDepth = new Map<number, Set<StructuralStepKind>>();
  const addSegmentForDepth = (depth: number, segment: StructuralStepKind) => {
    const set = activeSegmentsByDepth.get(depth) ?? new Set<StructuralStepKind>();
    set.add(segment);
    activeSegmentsByDepth.set(depth, set);
  };

  for (const diff of structure.nodeDiffs.values()) {
    if (diff.correspondence === 'enter') {
      addSegmentForDepth(diff.depth, 'fadeIn');
      continue;
    }
    if (diff.correspondence === 'exit') {
      addSegmentForDepth(diff.depth, 'fadeOut');
      continue;
    }
    const geometryNode = geometry.nodeGeometry.get(diff.id);
    if (!geometryNode) {
      continue;
    }
    if (geometryNode.localMoveX || geometryNode.localMoveY) {
      addSegmentForDepth(diff.depth, 'move');
    }
    if (geometryNode.shrinkX || geometryNode.shrinkY) addSegmentForDepth(diff.depth, 'shrink');
    if (geometryNode.growX || geometryNode.growY) addSegmentForDepth(diff.depth, 'grow');
  }

  const activeDepths = [...activeSegmentsByDepth.keys()].sort((a, b) => a - b);
  const executionDepths = direction === 'out' ? [...activeDepths].reverse() : activeDepths;

  const steps: SequencedTransitionAdvisory['steps'] = [];
  const stepIdByDepthAndKind = new Map<string, string>();
  let stepOrder = 0;
  for (const depth of executionDepths) {
    const activeSegments = buildInternalSegmentOrder(direction).filter((segment) =>
      activeSegmentsByDepth.get(depth)?.has(segment),
    );
    if (activeSegments.length === 0) continue;
    for (const segment of activeSegments) {
      const id = `${depth}:${segment}`;
      steps.push({
        id,
        depth,
        kind: segment,
        order: stepOrder,
      });
      stepIdByDepthAndKind.set(`${depth}:${segment}`, id);
      stepOrder += 1;
    }
  }

  const getStepId = (depth: number, kind: StructuralStepKind) =>
    stepIdByDepthAndKind.get(`${depth}:${kind}`);
  const stepOrderById = new Map(steps.map((step) => [step.id, step.order]));

  const nodeAdvisories = new Map<string, StructuralNodeAdvisory>();
  for (const diff of structure.nodeDiffs.values()) {
    if (diff.correspondence === 'enter') {
      const fadeStepId = getStepId(diff.depth, 'fadeIn');
      if (!fadeStepId) continue;
      nodeAdvisories.set(diff.id, {
        id: diff.id,
        fadeStepId,
        fadeMode: 'in',
      });
      continue;
    }
    if (diff.correspondence === 'exit') {
      const fadeStepId = getStepId(diff.depth, 'fadeOut');
      if (!fadeStepId) continue;
      nodeAdvisories.set(diff.id, {
        id: diff.id,
        fadeStepId,
        fadeMode: 'out',
      });
      continue;
    }
    const geometryNode = geometry.nodeGeometry.get(diff.id);
    if (!geometryNode) {
      continue;
    }
    const advisory: StructuralNodeAdvisory = { id: diff.id };
    if (geometryNode.localMoveX) {
      advisory.moveXStepId = getStepId(diff.depth, 'move');
    }
    if (geometryNode.localMoveY) {
      advisory.moveYStepId = getStepId(diff.depth, 'move');
    }
    if (geometryNode.shrinkX) {
      advisory.resizeXStepId = getStepId(diff.depth, 'shrink');
    } else if (geometryNode.growX) {
      advisory.resizeXStepId = getStepId(diff.depth, 'grow');
    }
    if (geometryNode.shrinkY) {
      advisory.resizeYStepId = getStepId(diff.depth, 'shrink');
    } else if (geometryNode.growY) {
      advisory.resizeYStepId = getStepId(diff.depth, 'grow');
    }
    if (
      advisory.moveXStepId ||
      advisory.moveYStepId ||
      advisory.resizeXStepId ||
      advisory.resizeYStepId ||
      advisory.fadeStepId
    ) {
      nodeAdvisories.set(diff.id, advisory);
    }
  }

  for (const geometryNode of geometry.nodeGeometry.values()) {
    const advisory = nodeAdvisories.get(geometryNode.id) ?? { id: geometryNode.id };
    if (!geometryNode.localMoveX && geometryNode.absoluteMoveX && !advisory.moveXStepId) {
      advisory.moveXStepId = geometryNode.inheritedMoveXParentId
        ? nodeAdvisories.get(geometryNode.inheritedMoveXParentId)?.moveXStepId
        : undefined;
    }
    if (!geometryNode.localMoveY && geometryNode.absoluteMoveY && !advisory.moveYStepId) {
      advisory.moveYStepId = geometryNode.inheritedMoveYParentId
        ? nodeAdvisories.get(geometryNode.inheritedMoveYParentId)?.moveYStepId
        : undefined;
    }
    if (
      advisory.moveXStepId ||
      advisory.moveYStepId ||
      advisory.resizeXStepId ||
      advisory.resizeYStepId ||
      advisory.fadeStepId
    ) {
      nodeAdvisories.set(geometryNode.id, advisory);
    }
  }

  const childFadeAdvisories = new Map<string, StructuralChildFadeAdvisory>();
  for (const childVisibility of structure.childVisibilityDiffs) {
    const candidateStepIds = childVisibility.childIds
      .map((childId) => {
        const child = structure.nodeDiffs.get(childId);
        if (!child) {
          return undefined;
        }
        return getStepId(child.depth, childVisibility.mode === 'in' ? 'fadeIn' : 'fadeOut');
      })
      .filter((stepId): stepId is string => Boolean(stepId));
    const stepId = pickEarlierStepId(candidateStepIds, stepOrderById);
    if (!stepId) {
      continue;
    }
    const stepOrderValue = stepOrderById.get(stepId) ?? 0;
    const existing = childFadeAdvisories.get(childVisibility.parentId);
    if (existing && existing.stepOrder <= stepOrderValue) {
      continue;
    }
    childFadeAdvisories.set(childVisibility.parentId, {
      parentId: childVisibility.parentId,
      stepId,
      stepOrder: stepOrderValue,
      mode: childVisibility.mode,
    });
  }

  const edgeAdvisories = buildEdgeSequenceAdvisories({
    edgeDiffs: structure.edgeDiffs,
    nodeAdvisories,
  });

  const controlSwitchAdvisories = new Map<string, NodeControlSwitchAdvisory>();
  for (const diff of structure.nodeDiffs.values()) {
    const advisory = buildNodeControlSwitchAdvisory({
      nodeId: diff.id,
      nodeAdvisories,
      childFadeAdvisories,
      stepOrderById,
    });
    if (advisory) {
      controlSwitchAdvisories.set(diff.id, advisory);
    }
  }

  return {
    steps,
    nodeAdvisories,
    childFadeAdvisories,
    edgeAdvisories,
    controlSwitchAdvisories,
  };
}
