import type { CompiledDiagramEdge } from '../../../semantic';
import type { LayoutTree } from '../layout/tree-traverser';
import type { AnimationSettings } from './animation-constants';
import { buildSequencedTransitionAdvisory } from './sequencer/entities';
import { buildTransitionGeometryAdvisory } from './sequencer/geometry';
import { buildStructuralTransitionDiff } from './sequencer/structure';
import type { TransitionPlanningAdvisory } from './sequencer/types';

export {
  buildTimedTransitionPlan,
  buildTimedTransitionSequence,
  type TimedTransitionPlan,
  type TimedTransitionSequence,
} from './timed-plan';

/**
 * Planner
 * - Stateless diff between two layout trees (from/to).
 * - Computes structural correspondence, geometry channel facts, and logical execution steps.
 * - Preserves safety constraints such as shrink-before-move and inherited movement.
 * - Does not assign durations, normalized windows, or interpolation progress.
 */

export type {
  ChildFadeTiming,
  EdgePlan,
  NodeControlSwitchAdvisory,
  NodeTiming,
  PhaseWindow,
  SequencedTransitionAdvisory,
  StructuralTransitionDiff,
  TransitionGeometryAdvisory,
  TransitionPlanningAdvisory,
} from './sequencer/types';
export { diagramViewNodeControlsEqual } from './sequencer/types';

export function buildTransitionPlanningAdvisory(params: {
  direction?: 'in' | 'out';
  fromTree: LayoutTree;
  toTree: LayoutTree;
  fromEdges?: CompiledDiagramEdge[];
  toEdges?: CompiledDiagramEdge[];
  animationSettings?: AnimationSettings;
}): TransitionPlanningAdvisory {
  const { direction = 'in', fromTree, toTree, fromEdges, toEdges, animationSettings } = params;
  void animationSettings;
  const structure = buildStructuralTransitionDiff({
    direction,
    fromTree,
    toTree,
    fromEdges: fromEdges ?? [],
    toEdges: toEdges ?? [],
  });
  const geometry = buildTransitionGeometryAdvisory({
    fromTree,
    toTree,
    structure,
  });
  const sequence = buildSequencedTransitionAdvisory({
    direction,
    structure,
    geometry,
  });
  return {
    direction,
    structure,
    geometry,
    sequence,
  };
}
