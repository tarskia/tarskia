import { describe, expect, it } from 'vitest';
import {
  buildRawSchemaSet,
  buildSchemaRuntime,
  buildSchemaSelection,
} from '../../../model/schema-runtime';
import baseRaw from '../../../schemas/base.yaml?raw';
import codeRaw from '../../../schemas/code.yaml?raw';
import dataModelRaw from '../../../schemas/data-model.yaml?raw';
import frontendRaw from '../../../schemas/frontend.yaml?raw';
import kubernetesRaw from '../../../schemas/kubernetes.yaml?raw';
import softwareRaw from '../../../schemas/software.yaml?raw';
import webAppRaw from '../../../schemas/web-app.yaml?raw';
import { compileDiagramViewState, indexTree } from '../../../semantic';
import { sampleDiagramRaw } from '../../../semantic/bundled-diagrams';
import { parseDocument, parseSchema } from '../../../util/serialization';
import { buildGraphModel } from '../graph/graph-model';
import { buildLayoutResult } from '../layout/layout-pipeline';
import type { LayoutNode, LayoutTree } from '../layout/tree-traverser';
import { ANIMATION_CONSTANTS } from './animation-constants';
import { computeZoomAnimation } from './animator';
import { buildTransitionPlanningAdvisory } from './sequencer';
import {
  buildSegmentOrder,
  buildSegmentWindows,
  durationForSegment,
  getInterSegmentPause,
} from './sequencer/utils';
import { buildTimedTransitionPlan } from './timed-plan';

type NodeDef = {
  id: string;
  pos?: { x: number; y: number };
  size?: { width: number; height: number };
  children?: NodeDef[];
};

const buildNode = (def: NodeDef, parentId?: string): LayoutNode => {
  const children = (def.children ?? []).map((child) => buildNode(child, def.id));
  const size = def.size ?? { width: 120, height: 80 };
  return {
    id: def.id,
    entity: {
      id: def.id,
      type: 'core/test-node',
    },
    parentId,
    baseSize: size,
    size,
    position: def.pos ?? { x: 0, y: 0 },
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

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const TIMELINE_MS = ANIMATION_CONSTANTS.timelineMs;

const buildPlan = (params: {
  direction?: 'in' | 'out';
  fromTree: LayoutTree;
  toTree: LayoutTree;
  fromEdges?: Parameters<typeof buildTransitionPlanningAdvisory>[0]['fromEdges'];
  toEdges?: Parameters<typeof buildTransitionPlanningAdvisory>[0]['toEdges'];
}) =>
  buildTimedTransitionPlan({
    planningAdvisory: buildTransitionPlanningAdvisory(params),
  });

const sizeAt = (params: {
  plan: ReturnType<typeof buildTimedTransitionPlan>;
  id: string;
  axis: 'width' | 'height';
  fromTree: LayoutTree;
  toTree: LayoutTree;
  progress: number;
}) => {
  const { plan, id, axis, fromTree, toTree, progress } = params;
  const fromNode = fromTree.byId.get(id);
  const toNode = toTree.byId.get(id);
  const fromSize = fromNode?.size[axis] ?? toNode?.size[axis] ?? 0;
  const toSize = toNode?.size[axis] ?? fromNode?.size[axis] ?? fromSize;
  const timing = plan.nodeTimings.get(id);
  const window = axis === 'width' ? timing?.resizeX : timing?.resizeY;
  const amount = window
    ? clamp((progress - window.start) / (window.end - window.start), 0, 1)
    : fromSize === toSize
      ? 1
      : 0;
  return lerp(fromSize, toSize, amount);
};

const expectedSegmentWindows = (direction: 'in' | 'out') => {
  const order = buildSegmentOrder(direction);
  const pause = getInterSegmentPause(direction, TIMELINE_MS);
  const totalDuration =
    order.reduce((sum, segment) => sum + durationForSegment(segment, direction, 1), 0) +
    pause * (order.length - 1);
  let cursor = 0;
  const windows: Record<string, { start: number; end: number }> = {};
  order.forEach((segment, index) => {
    const start = cursor;
    const end = cursor + durationForSegment(segment, direction, 1);
    windows[segment] = {
      start: start / totalDuration,
      end: end / totalDuration,
    };
    cursor = end;
    if (index < order.length - 1) {
      cursor += pause;
    }
  });
  return windows;
};

describe('buildTimedTransitionPlan', () => {
  it('splits structure, geometry, and sequencing into separate advisories', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 40, y: 0 },
      },
    ]);

    const planningAdvisory = buildTransitionPlanningAdvisory({
      direction: 'in',
      fromTree,
      toTree,
    });
    const structureNode = planningAdvisory.structure.nodeDiffs.get('A');
    const geometryNode = planningAdvisory.geometry.nodeGeometry.get('A');
    const sequenceNode = planningAdvisory.sequence.nodeAdvisories.get('A');

    expect(planningAdvisory.structure).not.toHaveProperty('basePositions');
    expect(planningAdvisory.geometry).not.toHaveProperty('steps');
    expect(planningAdvisory.sequence).not.toHaveProperty('basePositions');
    expect(structureNode && 'localMoveX' in structureNode).toBe(false);
    expect(geometryNode && 'moveXStepId' in geometryNode).toBe(false);
    expect(sequenceNode && 'depth' in sequenceNode).toBe(false);
  });

  it('binds child-group controls to the parent child-fade step when children appear', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [{ id: 'B', pos: { x: 20, y: 20 } }],
      },
    ]);

    const planningAdvisory = buildTransitionPlanningAdvisory({
      direction: 'in',
      fromTree,
      toTree,
    });

    const childFade = planningAdvisory.sequence.childFadeAdvisories.get('A');
    const controlSwitch = planningAdvisory.sequence.controlSwitchAdvisories.get('A');

    expect(childFade?.mode).toBe('in');
    expect(controlSwitch?.childGroupControlsAppearAtStepId).toBe(childFade?.stepId);
  });

  it('stages descendant fade based on depth when expanding into an expanded node', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [{ id: 'B', pos: { x: 20, y: 20 } }],
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [
          {
            id: 'B',
            pos: { x: 20, y: 20 },
            children: [{ id: 'C', pos: { x: 12, y: 12 } }],
          },
        ],
      },
    ]);

    const sequence = buildPlan({
      direction: 'in',
      fromTree,
      toTree,
    });

    const timingC = sequence.nodeTimings.get('C');
    expect(timingC?.fade).toBeDefined();
    expect((timingC?.fade?.start ?? -1) >= 0).toBe(true);
    expect((timingC?.fade?.end ?? 2) <= 1).toBe(true);
  });

  it('anchors child fade to nearest moving ancestor depth', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [{ id: 'B', pos: { x: 20, y: 20 } }],
      },
    ]);
    const toTreeWithMovingAncestor = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [
          {
            // Move B so it is considered a geometry-changing ancestor.
            id: 'B',
            pos: { x: 40, y: 20 },
            children: [{ id: 'C', pos: { x: 12, y: 12 } }],
          },
        ],
      },
    ]);
    const toTreeWithoutMovingAncestor = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [
          {
            id: 'B',
            pos: { x: 20, y: 20 },
            children: [{ id: 'C', pos: { x: 12, y: 12 } }],
          },
        ],
      },
    ]);

    const sequenceWithMovingAncestor = buildPlan({
      direction: 'in',
      fromTree,
      toTree: toTreeWithMovingAncestor,
    });
    const sequenceWithoutMovingAncestor = buildPlan({
      direction: 'in',
      fromTree,
      toTree: toTreeWithoutMovingAncestor,
    });

    const anchoredFadeStart = sequenceWithMovingAncestor.nodeTimings.get('C')?.fade?.start ?? 1;
    const fallbackFadeStart = sequenceWithoutMovingAncestor.nodeTimings.get('C')?.fade?.start ?? 1;
    expect(anchoredFadeStart).toBeGreaterThan(fallbackFadeStart);
  });

  it('contracts by fading contents before moving outside nodes when only descendants disappear', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [{ id: 'B', pos: { x: 30, y: 30 } }],
      },
      { id: 'X', pos: { x: 240, y: 0 } },
    ]);
    const toTree = buildTree([
      { id: 'A', pos: { x: 0, y: 0 } },
      { id: 'X', pos: { x: 280, y: 0 } },
    ]);

    const sequence = buildPlan({
      direction: 'out',
      fromTree,
      toTree,
    });

    const windows = expectedSegmentWindows('out');
    const timingA = sequence.nodeTimings.get('A');
    const timingB = sequence.nodeTimings.get('B');
    const timingX = sequence.nodeTimings.get('X');

    expect(timingA?.resizeX).toBeUndefined();
    expect(timingA?.resizeY).toBeUndefined();
    expect(timingB?.fade?.start).toBeCloseTo(windows.fade.start, 3);
    expect(timingX?.moveX).toBeDefined();
    expect((timingX?.moveX?.start ?? 0) >= (timingB?.fade?.end ?? 1)).toBe(true);
  });

  it('stages multi-branch expansion fades by depth', () => {
    const fromTree = buildTree([{ id: 'A', pos: { x: 0, y: 0 } }]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [
          { id: 'B', pos: { x: 12, y: 12 } },
          { id: 'C', pos: { x: 80, y: 12 } },
        ],
      },
    ]);

    const sequence = buildPlan({
      direction: 'in',
      fromTree,
      toTree,
    });

    const timingB = sequence.nodeTimings.get('B');
    const timingC = sequence.nodeTimings.get('C');
    expect(timingB?.fade).toBeDefined();
    expect(timingC?.fade).toBeDefined();
    expect(timingB?.fade?.start).toBeCloseTo(timingC?.fade?.start ?? 0, 3);
    expect((timingB?.fade?.start ?? 1) < 0.2).toBe(true);
  });

  it('contracts multi-branch children in the same fade window', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        children: [
          { id: 'B', pos: { x: 12, y: 12 } },
          { id: 'C', pos: { x: 80, y: 12 } },
        ],
      },
    ]);
    const toTree = buildTree([{ id: 'A', pos: { x: 0, y: 0 } }]);

    const sequence = buildPlan({
      direction: 'out',
      fromTree,
      toTree,
    });

    const windows = expectedSegmentWindows('out');
    const timingB = sequence.nodeTimings.get('B');
    const timingC = sequence.nodeTimings.get('C');
    expect(timingB?.fade?.start).toBeCloseTo(windows.fade.start, 3);
    expect(timingC?.fade?.start).toBeCloseTo(windows.fade.start, 3);
  });

  it('produces phase windows in strict order for expansion and contraction', () => {
    const assertOrder = (direction: 'in' | 'out') => {
      const order = buildSegmentOrder(direction);
      const pause = getInterSegmentPause(direction, TIMELINE_MS);
      const depthDuration =
        order.reduce((sum, segment) => sum + durationForSegment(segment, direction, 1), 0) +
        pause * (order.length - 1);
      const windows = buildSegmentWindows(direction, 0, depthDuration, depthDuration, 1);
      let prevEnd = Number.NEGATIVE_INFINITY;
      for (const segment of order) {
        const window = windows[segment];
        expect(window.start).toBeGreaterThanOrEqual(prevEnd);
        expect(window.end).toBeGreaterThan(window.start);
        prevEnd = window.end;
      }
    };

    assertOrder('in');
    assertOrder('out');
  });

  it('keeps expansion continuous while preserving contraction pauses', () => {
    const expansionOrder = buildSegmentOrder('in');
    const expansionDepthDuration =
      expansionOrder.reduce((sum, segment) => sum + durationForSegment(segment, 'in', 1), 0) +
      getInterSegmentPause('in', TIMELINE_MS) * (expansionOrder.length - 1);
    const expansionWindows = buildSegmentWindows(
      'in',
      0,
      expansionDepthDuration,
      expansionDepthDuration,
      1,
    );

    for (let index = 0; index < expansionOrder.length - 1; index += 1) {
      const current = expansionWindows[expansionOrder[index] ?? ''];
      const next = expansionWindows[expansionOrder[index + 1] ?? ''];
      expect(current).toBeDefined();
      expect(next).toBeDefined();
      expect(next?.start).toBeCloseTo(current?.end ?? 0, 6);
    }

    const collapseOrder = buildSegmentOrder('out');
    const collapseDepthDuration =
      collapseOrder.reduce((sum, segment) => sum + durationForSegment(segment, 'out', 1), 0) +
      getInterSegmentPause('out', TIMELINE_MS) * (collapseOrder.length - 1);
    const collapseWindows = buildSegmentWindows(
      'out',
      0,
      collapseDepthDuration,
      collapseDepthDuration,
      1,
    );

    let sawPause = false;
    for (let index = 0; index < collapseOrder.length - 1; index += 1) {
      const current = collapseWindows[collapseOrder[index] ?? ''];
      const next = collapseWindows[collapseOrder[index + 1] ?? ''];
      if ((next?.start ?? 0) > (current?.end ?? 0)) {
        sawPause = true;
      }
    }
    expect(sawPause).toBe(true);
  });

  it('stages two-axis expansion channels horizontally before vertically within each coarse step', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 180, height: 120 },
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 80, y: 60 },
        size: { width: 260, height: 200 },
      },
    ]);

    const sequence = buildPlan({
      direction: 'in',
      fromTree,
      toTree,
    });

    const timingA = sequence.nodeTimings.get('A');
    expect(timingA?.moveX).toBeDefined();
    expect(timingA?.moveY).toBeDefined();
    expect(timingA?.resizeX).toBeDefined();
    expect(timingA?.resizeY).toBeDefined();
    expect((timingA?.moveY?.start ?? 0) >= (timingA?.moveX?.end ?? 1)).toBe(true);
    expect((timingA?.resizeX?.start ?? 0) >= (timingA?.moveY?.end ?? 1)).toBe(true);
    expect((timingA?.resizeY?.start ?? 0) >= (timingA?.resizeX?.end ?? 1)).toBe(true);
  });

  it('schedules resize windows for pure geometry changes with no added/removed nodes', () => {
    const fromTree = buildTree([
      { id: 'A', pos: { x: 0, y: 0 }, size: { width: 180, height: 120 } },
    ]);
    const toTree = buildTree([{ id: 'A', pos: { x: 0, y: 0 }, size: { width: 180, height: 80 } }]);

    const sequence = buildPlan({
      direction: 'out',
      fromTree,
      toTree,
    });

    const timingA = sequence.nodeTimings.get('A');
    expect(timingA?.resizeY).toBeDefined();
  });

  it('keeps shallow->deep order while deferring sibling move/open until close completes', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 320 },
        children: [
          { id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 140 } },
          {
            id: 'C',
            pos: { x: 20, y: 180 },
            size: { width: 160, height: 100 },
          },
        ],
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 320 },
        children: [
          { id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 100 } },
          {
            id: 'C',
            pos: { x: 20, y: 140 },
            size: { width: 160, height: 140 },
          },
        ],
      },
    ]);

    const sequence = buildPlan({
      direction: 'in',
      fromTree,
      toTree,
    });

    const timingB = sequence.nodeTimings.get('B');
    const timingC = sequence.nodeTimings.get('C');
    expect(timingB?.resizeY).toBeDefined();
    expect(timingC?.resizeY).toBeDefined();
    expect(timingC?.moveY).toBeDefined();
    expect((timingC?.moveY?.start ?? 0) >= (timingB?.resizeY?.end ?? 1)).toBe(true);
    expect((timingC?.resizeY?.start ?? 0) >= (timingB?.resizeY?.end ?? 1)).toBe(true);
  });

  it('expands a child drawer in parent-resize then sibling-move then child-resize order', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 360 },
        children: [
          { id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 100 } },
          {
            id: 'C',
            pos: { x: 20, y: 130 },
            size: { width: 160, height: 100 },
          },
          {
            id: 'D',
            pos: { x: 20, y: 240 },
            size: { width: 160, height: 100 },
          },
        ],
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 400 },
        children: [
          { id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 140 } },
          {
            id: 'C',
            pos: { x: 20, y: 180 },
            size: { width: 160, height: 100 },
          },
          {
            id: 'D',
            pos: { x: 20, y: 290 },
            size: { width: 160, height: 100 },
          },
        ],
      },
    ]);

    const sequence = buildPlan({
      direction: 'in',
      fromTree,
      toTree,
    });

    const timingA = sequence.nodeTimings.get('A');
    const timingB = sequence.nodeTimings.get('B');
    const timingC = sequence.nodeTimings.get('C');
    const timingD = sequence.nodeTimings.get('D');
    expect(timingA?.resizeY).toBeDefined();
    expect(timingB?.resizeY).toBeDefined();
    expect(timingC?.moveY).toBeDefined();
    expect(timingD?.moveY).toBeDefined();
    expect((timingC?.moveY?.start ?? 0) >= (timingA?.resizeY?.end ?? 1)).toBe(true);
    expect((timingD?.moveY?.start ?? 0) >= (timingA?.resizeY?.end ?? 1)).toBe(true);
    expect((timingB?.resizeY?.start ?? 0) >= (timingC?.moveY?.end ?? 1)).toBe(true);
    expect((timingB?.resizeY?.start ?? 0) >= (timingD?.moveY?.end ?? 1)).toBe(true);
  });

  it('collapses a child drawer in child-resize then sibling-move then parent-resize order', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 400 },
        children: [
          { id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 140 } },
          {
            id: 'C',
            pos: { x: 20, y: 180 },
            size: { width: 160, height: 100 },
          },
          {
            id: 'D',
            pos: { x: 20, y: 290 },
            size: { width: 160, height: 100 },
          },
        ],
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 360 },
        children: [
          { id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 100 } },
          {
            id: 'C',
            pos: { x: 20, y: 140 },
            size: { width: 160, height: 100 },
          },
          {
            id: 'D',
            pos: { x: 20, y: 250 },
            size: { width: 160, height: 100 },
          },
        ],
      },
    ]);

    const sequence = buildPlan({
      direction: 'out',
      fromTree,
      toTree,
    });

    const timingA = sequence.nodeTimings.get('A');
    const timingB = sequence.nodeTimings.get('B');
    const timingC = sequence.nodeTimings.get('C');
    const timingD = sequence.nodeTimings.get('D');
    expect(timingA?.resizeY).toBeDefined();
    expect(timingB?.resizeY).toBeDefined();
    expect(timingC?.moveY).toBeDefined();
    expect(timingD?.moveY).toBeDefined();
    expect((timingC?.moveY?.start ?? 0) >= (timingB?.resizeY?.end ?? 1)).toBe(true);
    expect((timingD?.moveY?.start ?? 0) >= (timingB?.resizeY?.end ?? 1)).toBe(true);
    expect((timingA?.resizeY?.start ?? 0) >= (timingC?.moveY?.end ?? 1)).toBe(true);
    expect((timingA?.resizeY?.start ?? 0) >= (timingD?.moveY?.end ?? 1)).toBe(true);
  });

  it('keeps sibling switch transitions overlap-free at sampled animation times', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 320 },
        children: [
          { id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 140 } },
          {
            id: 'C',
            pos: { x: 20, y: 180 },
            size: { width: 160, height: 100 },
          },
        ],
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 320 },
        children: [
          { id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 100 } },
          {
            id: 'C',
            pos: { x: 20, y: 140 },
            size: { width: 160, height: 140 },
          },
        ],
      },
    ]);

    const sequence = buildPlan({
      direction: 'in',
      fromTree,
      toTree,
    });

    const samples = 60;
    for (let step = 0; step <= samples; step += 1) {
      const progress = step / samples;
      const animation = computeZoomAnimation({ progress, plan: sequence });
      const bY = animation.positions.B?.y ?? 0;
      const cY = animation.positions.C?.y ?? 0;
      const bHeight = sizeAt({
        plan: sequence,
        id: 'B',
        axis: 'height',
        fromTree,
        toTree,
        progress,
      });
      const bBottom = bY + bHeight;
      expect(bBottom <= cY + 1e-6).toBe(true);
    }
  });

  it('moves descendants with moved non-branch parents during expansion', () => {
    const fromTree = buildTree([
      { id: 'P', pos: { x: 0, y: 0 }, size: { width: 220, height: 160 } },
      {
        id: 'Q',
        pos: { x: 260, y: 0 },
        size: { width: 200, height: 160 },
        children: [{ id: 'R', pos: { x: 20, y: 20 }, size: { width: 120, height: 80 } }],
      },
    ]);
    const toTree = buildTree([
      { id: 'P', pos: { x: 0, y: 0 }, size: { width: 420, height: 160 } },
      {
        id: 'Q',
        pos: { x: 460, y: 0 },
        size: { width: 200, height: 160 },
        children: [{ id: 'R', pos: { x: 20, y: 20 }, size: { width: 120, height: 80 } }],
      },
    ]);

    const sequence = buildPlan({
      direction: 'in',
      fromTree,
      toTree,
    });

    const timingQ = sequence.nodeTimings.get('Q');
    const timingR = sequence.nodeTimings.get('R');
    expect(timingQ?.moveX).toBeDefined();
    expect(timingR?.moveX).toBeDefined();
    expect(timingR?.moveX?.start).toBeCloseTo(timingQ?.moveX?.start ?? 0, 4);
    expect(timingR?.moveX?.end).toBeCloseTo(timingQ?.moveX?.end ?? 0, 4);
  });

  it('fades collapsing children out before parent shrink begins at sampled times', () => {
    const fromTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 220 },
        children: [{ id: 'B', pos: { x: 20, y: 20 }, size: { width: 160, height: 100 } }],
      },
    ]);
    const toTree = buildTree([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 220, height: 120 },
      },
    ]);

    const sequence = buildPlan({
      direction: 'out',
      fromTree,
      toTree,
    });

    const fromAHeight = fromTree.byId.get('A')?.size.height ?? 0;
    let sawParentShrink = false;
    const samples = 60;
    for (let step = 0; step <= samples; step += 1) {
      const progress = step / samples;
      const animation = computeZoomAnimation({ progress, plan: sequence });
      const aHeight = sizeAt({
        plan: sequence,
        id: 'A',
        axis: 'height',
        fromTree,
        toTree,
        progress,
      });
      const bOpacity = animation.nodeVisibility.get('B') ?? 1;
      if (aHeight < fromAHeight - 1e-6) {
        sawParentShrink = true;
        expect(bOpacity).toBeLessThanOrEqual(0.05);
      }
    }
    expect(sawParentShrink).toBe(true);
  });

  it('keeps top-level nodes finite and settled without overlap while expanding data-platform', () => {
    const raw = buildRawSchemaSet([
      parseSchema(baseRaw),
      parseSchema(softwareRaw),
      parseSchema(webAppRaw),
      parseSchema(codeRaw),
      parseSchema(frontendRaw),
      parseSchema(dataModelRaw),
      parseSchema(kubernetesRaw),
    ]);
    const schema = buildSchemaRuntime({
      raw,
      selection: buildSchemaSelection({ raw }),
    }).resolved.effectiveSchema;
    const fromDoc = parseDocument(sampleDiagramRaw);
    const toDoc = {
      ...fromDoc,
      view: {
        ...(fromDoc.view ?? { kind: 'semantic-diagram-view', version: 2 }),
        kind: 'semantic-diagram-view' as const,
        version: 2 as const,
        nodesById: {
          ...(fromDoc.view?.nodesById ?? {}),
          'data-platform': {
            ...(fromDoc.view?.nodesById?.['data-platform'] ?? {}),
            expanded: true,
          },
        },
      },
    };
    const fromGraph = buildGraphModel(fromDoc, schema);
    const toGraph = buildGraphModel(toDoc, schema);
    const fromViewState = compileDiagramViewState({ doc: fromDoc, schema });
    const toViewState = compileDiagramViewState({ doc: toDoc, schema });
    const fromLayout = buildLayoutResult({
      graph: fromGraph,
      viewState: fromViewState,
      layout: fromDoc.view?.layout,
    });
    const toLayout = buildLayoutResult({
      graph: toGraph,
      viewState: toViewState,
      layout: toDoc.view?.layout,
    });

    const sequence = buildPlan({
      direction: 'in',
      fromTree: fromLayout.tree,
      toTree: toLayout.tree,
      fromEdges: fromLayout.edges,
      toEdges: toLayout.edges,
    });

    const topLevelIds = toLayout.tree.root.children.map((node) => node.id);
    const overlaps = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

    const samples = 80;
    for (let step = 0; step <= samples; step += 1) {
      const progress = step / samples;
      const animation = computeZoomAnimation({ progress, plan: sequence });
      const rects = topLevelIds
        .map((id) => {
          const position = animation.positions[id];
          if (!position) return null;
          return {
            id,
            x: position.x,
            y: position.y,
            width: sizeAt({
              plan: sequence,
              id,
              axis: 'width',
              fromTree: fromLayout.tree,
              toTree: toLayout.tree,
              progress,
            }),
            height: sizeAt({
              plan: sequence,
              id,
              axis: 'height',
              fromTree: fromLayout.tree,
              toTree: toLayout.tree,
              progress,
            }),
          };
        })
        .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));

      for (const rect of rects) {
        expect(Number.isFinite(rect.x), `x should be finite for ${rect.id}`).toBe(true);
        expect(Number.isFinite(rect.y), `y should be finite for ${rect.id}`).toBe(true);
        expect(Number.isFinite(rect.width), `width should be finite for ${rect.id}`).toBe(true);
        expect(Number.isFinite(rect.height), `height should be finite for ${rect.id}`).toBe(true);
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
      }

      if (progress !== 0 && progress !== 1) {
        continue;
      }

      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const left = rects[i];
          const right = rects[j];
          if (!left || !right) continue;
          expect(
            overlaps(left, right),
            `settled overlap at progress=${progress.toFixed(3)} between ${left.id} and ${right.id}`,
          ).toBe(false);
        }
      }
    }
  });
});
