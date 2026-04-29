import type { CompiledDiagramEdge, DiagramViewNodeControls } from '../../../../semantic';

export interface PhaseWindow {
  start: number;
  end: number;
}

export type StructuralStepKind = 'fadeOut' | 'shrink' | 'move' | 'grow' | 'fadeIn';

export interface StructuralTransitionStep {
  id: string;
  depth: number;
  kind: StructuralStepKind;
  order: number;
}

export interface StructuralNodeDiff {
  id: string;
  correspondence: 'stable' | 'enter' | 'exit';
  depth: number;
  fromDepth?: number;
  toDepth?: number;
  fromParentId?: string;
  toParentId?: string;
}

export interface StructuralChildVisibilityDiff {
  parentId: string;
  mode: 'in' | 'out';
  childIds: string[];
}

export interface StructuralEdgeDiff extends CompiledDiagramEdge {
  correspondence: 'stable' | 'enter' | 'exit' | 'reroute';
  hideAtStart?: boolean;
  appearingEndpointIds?: string[];
  disappearingEndpointIds?: string[];
}

export interface StructuralTransitionDiff {
  rootIds: {
    from: string;
    to: string;
  };
  nodeDiffs: Map<string, StructuralNodeDiff>;
  childVisibilityDiffs: StructuralChildVisibilityDiff[];
  edgeDiffs: StructuralEdgeDiff[];
}

export interface TransitionGeometryNodeAdvisory {
  id: string;
  depth: number;
  parentId?: string;
  localMoveX: boolean;
  localMoveY: boolean;
  absoluteMoveX: boolean;
  absoluteMoveY: boolean;
  shrinkX: boolean;
  shrinkY: boolean;
  growX: boolean;
  growY: boolean;
  inheritedMoveXParentId?: string;
  inheritedMoveYParentId?: string;
}

export interface TransitionGeometryAdvisory {
  basePositions: Record<string, { x: number; y: number }>;
  targetPositions: Record<string, { x: number; y: number }>;
  nodeGeometry: Map<string, TransitionGeometryNodeAdvisory>;
}

export interface StructuralNodeAdvisory {
  id: string;
  moveXStepId?: string;
  moveYStepId?: string;
  resizeXStepId?: string;
  resizeYStepId?: string;
  fadeStepId?: string;
  fadeMode?: 'in' | 'out';
}

export interface StructuralChildFadeAdvisory {
  parentId: string;
  stepId: string;
  stepOrder: number;
  mode: 'in' | 'out';
}

export interface StructuralEdgeSequenceAdvisory {
  id: string;
  fadeMode?: 'in' | 'out';
  fadeEndpointIds?: string[];
}

export interface NodeControlSwitchAdvisory {
  id: string;
  appearAtStepId?: string;
  disappearAtStepId?: string;
  childGroupControlsAppearAtStepId?: string;
  childGroupControlsDisappearAtStepId?: string;
}

export interface SequencedTransitionAdvisory {
  steps: StructuralTransitionStep[];
  nodeAdvisories: Map<string, StructuralNodeAdvisory>;
  childFadeAdvisories: Map<string, StructuralChildFadeAdvisory>;
  edgeAdvisories: Map<string, StructuralEdgeSequenceAdvisory>;
  controlSwitchAdvisories: Map<string, NodeControlSwitchAdvisory>;
}

export interface TransitionPlanningAdvisory {
  direction: 'in' | 'out';
  structure: StructuralTransitionDiff;
  geometry: TransitionGeometryAdvisory;
  sequence: SequencedTransitionAdvisory;
}

export interface NodeTiming {
  moveX?: PhaseWindow;
  moveY?: PhaseWindow;
  resizeX?: PhaseWindow;
  resizeY?: PhaseWindow;
  fade?: PhaseWindow;
  fadeMode?: 'in' | 'out';
}

export interface ChildFadeTiming {
  window: PhaseWindow;
  mode: 'in' | 'out';
}

export interface EdgePlan extends CompiledDiagramEdge {
  relationIds?: string[];
  hideAtStart?: boolean;
  fade?: PhaseWindow;
  fadeMode?: 'in' | 'out';
}

export const diagramViewNodeControlsEqual = (
  left: DiagramViewNodeControls | undefined,
  right: DiagramViewNodeControls | undefined,
) =>
  left?.targetId === right?.targetId &&
  left?.showZoomControls === right?.showZoomControls &&
  left?.canZoomIn === right?.canZoomIn &&
  left?.canZoomOut === right?.canZoomOut &&
  left?.showDetailControls === right?.showDetailControls &&
  left?.canExpandDetails === right?.canExpandDetails &&
  left?.canCollapseDetails === right?.canCollapseDetails &&
  left?.showChildGroupControls === right?.showChildGroupControls &&
  left?.canExpandChildGroups === right?.canExpandChildGroups &&
  left?.canCollapseChildGroups === right?.canCollapseChildGroups;
