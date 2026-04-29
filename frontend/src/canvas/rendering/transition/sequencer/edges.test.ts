import { describe, expect, it } from 'vitest';
import { buildCompiledDiagramEdgeId, indexTree } from '../../../../semantic';
import type { LayoutNode, LayoutTree } from '../../layout/tree-traverser';
import type { ResolvedVisualEdge } from '../../visual/edge-visuals';
import { buildTransitionPlanningAdvisory } from '../sequencer';
import { buildTimedTransitionPlan } from '../timed-plan';

type NodeDef = {
  id: string;
  children?: NodeDef[];
};

const buildNode = (def: NodeDef, parentId?: string): LayoutNode => {
  const children = (def.children ?? []).map((child) => buildNode(child, def.id));
  return {
    id: def.id,
    entity: {
      id: def.id,
      type: 'core/test-node',
    },
    parentId,
    baseSize: { width: 120, height: 80 },
    size: { width: 120, height: 80 },
    position: { x: 0, y: 0 },
    children,
  };
};

const buildTree = (defs: NodeDef[]): LayoutTree => {
  const root: LayoutNode = {
    id: 'root',
    entity: {
      id: 'root',
      type: 'viewport',
      name: 'Root',
    },
    baseSize: { width: 0, height: 0 },
    size: { width: 0, height: 0 },
    children: defs.map((def) => buildNode(def, 'root')),
  };
  const byId = new Map<string, LayoutNode>();
  const collect = (node: LayoutNode) => {
    byId.set(node.id, node);
    node.children.forEach(collect);
  };
  collect(root);
  return indexTree({ rootId: root.id, byId });
};

describe('timed edge plans', () => {
  it('drops edges when endpoints collapse to the same ancestor', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        children: [{ id: 'B' }, { id: 'C' }],
      },
    ]);
    const toTree = buildTree([{ id: 'A' }]);

    const sequence = buildTimedTransitionPlan({
      planningAdvisory: buildTransitionPlanningAdvisory({
        direction: 'out',
        fromTree,
        toTree,
        fromEdges: [
          {
            id: buildCompiledDiagramEdgeId('rel-1', 'B', 'C'),
            relationId: 'rel-1',
            sourceId: 'B',
            targetId: 'C',
            type: 'joins',
          },
        ],
        toEdges: [],
      }),
    });

    const edgePlans = sequence.edgePlans;
    expect(edgePlans.length).toBe(1);
    expect(edgePlans[0]?.hideAtStart).toBe(true);
  });

  it('hides old route immediately while new route fades in', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        children: [{ id: 'B' }],
      },
      { id: 'X' },
    ]);
    const toTree = buildTree([{ id: 'A' }, { id: 'X' }]);

    const sequence = buildTimedTransitionPlan({
      planningAdvisory: buildTransitionPlanningAdvisory({
        direction: 'out',
        fromTree,
        toTree,
        fromEdges: [
          {
            id: buildCompiledDiagramEdgeId('rel-2', 'B', 'X'),
            relationId: 'rel-2',
            sourceId: 'B',
            targetId: 'X',
            type: 'reads',
          },
        ],
        toEdges: [
          {
            id: buildCompiledDiagramEdgeId('rel-2', 'A', 'X'),
            relationId: 'rel-2',
            sourceId: 'A',
            targetId: 'X',
            type: 'reads',
          },
        ],
      }),
    });

    const oldRoute = sequence.edgePlans.find((plan) => plan.id === 'rel-2:B->X');
    const newRoute = sequence.edgePlans.find((plan) => plan.id === 'rel-2:A->X');

    expect(oldRoute?.hideAtStart).toBe(true);
    expect(newRoute?.fadeMode).toBe('in');
    expect(newRoute?.fade).toBeDefined();
    expect(newRoute?.fade?.start).toBeGreaterThanOrEqual(0.75);
    expect(newRoute?.fade?.end).toBe(1);
  });

  it('treats same-id endpoint reversals as a single reroute plan', () => {
    const fromTree = buildTree([{ id: 'queue' }, { id: 'subscriber' }]);
    const toTree = buildTree([{ id: 'queue' }, { id: 'subscriber' }]);
    const edgeId = buildCompiledDiagramEdgeId('rel-3', 'subscriber', 'queue');
    const fromEdges: ResolvedVisualEdge[] = [
      {
        id: edgeId,
        relationId: 'rel-3',
        semanticSourceId: 'subscriber',
        semanticTargetId: 'queue',
        sourceId: 'subscriber',
        targetId: 'queue',
        type: 'consumes',
      },
    ];
    const toEdges: ResolvedVisualEdge[] = [
      {
        id: edgeId,
        relationId: 'rel-3',
        semanticSourceId: 'subscriber',
        semanticTargetId: 'queue',
        sourceId: 'queue',
        targetId: 'subscriber',
        type: 'consumes',
      },
    ];

    const sequence = buildTimedTransitionPlan({
      planningAdvisory: buildTransitionPlanningAdvisory({
        direction: 'out',
        fromTree,
        toTree,
        fromEdges,
        toEdges,
      }),
    });

    expect(sequence.edgePlans).toHaveLength(1);
    expect(sequence.edgePlans[0]).toMatchObject({
      id: edgeId,
      sourceId: 'queue',
      targetId: 'subscriber',
    });
  });

  it('reveals new edges at the end even when no node steps are scheduled', () => {
    const tree = buildTree([{ id: 'A' }, { id: 'X' }]);

    const sequence = buildTimedTransitionPlan({
      planningAdvisory: buildTransitionPlanningAdvisory({
        direction: 'in',
        fromTree: tree,
        toTree: tree,
        fromEdges: [],
        toEdges: [
          {
            id: buildCompiledDiagramEdgeId('rel-4', 'A', 'X'),
            relationId: 'rel-4',
            sourceId: 'A',
            targetId: 'X',
            type: 'reads',
          },
        ],
      }),
    });

    expect(sequence.edgePlans).toHaveLength(1);
    expect(sequence.edgePlans[0]).toMatchObject({
      id: 'rel-4:A->X',
      fadeMode: 'in',
      fade: {
        start: 0.85,
        end: 1,
      },
    });
  });
});
