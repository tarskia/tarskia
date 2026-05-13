import { describe, expect, it } from 'vitest';
import { buildQualifiedSchemaObjectId, CORE_GROUP_TYPE_ID } from '../../../model/schema-ids';
import type { SchemaModule, SemanticDocument } from '../../../model/types';
import { compileDiagramViewState } from '../../../semantic';
import { buildGraphModel } from '../graph/graph-model';
import { buildLayoutResult } from '../layout/layout-pipeline';
import {
  buildStaticCanvasPresentation,
  type CanvasRenderSnapshot,
} from '../presentation/presentation';
import {
  buildTransitionOverlayState,
  captureTransitionOverlaySnapshot,
  resolveTransitionOverlayFrame,
} from './overlay';
import type { TransitionPlanningAdvisory } from './sequencer';
import { buildTransitionPlanningAdvisory } from './sequencer';
import {
  buildTimedTransitionPlan,
  buildTimedTransitionSequence,
  type TimedTransitionPlan,
  type TimedTransitionSequence,
} from './timed-plan';

const INTERACTION_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'interaction');
const APPLICATION_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'application');
const API_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'api');
const CALLS_RELATION_ID = buildQualifiedSchemaObjectId('user/test', 'relations', 'calls');

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  tags: [{ id: INTERACTION_TAG_ID, label: 'Interaction', color: '#ff0000' }],
  types: [
    {
      id: APPLICATION_TYPE_ID,
      label: 'Application',
      defaultTags: [INTERACTION_TAG_ID],
      display: { primaryTag: INTERACTION_TAG_ID },
    },
    {
      id: API_TYPE_ID,
      label: 'API',
      defaultTags: [INTERACTION_TAG_ID],
      display: { primaryTag: INTERACTION_TAG_ID },
    },
    {
      id: CORE_GROUP_TYPE_ID,
      label: 'Group',
      defaultTags: [INTERACTION_TAG_ID],
      display: { primaryTag: INTERACTION_TAG_ID },
    },
  ],
  relations: [
    {
      id: CALLS_RELATION_ID,
      label: 'Calls',
      shortLabel: 'call',
    },
  ],
};

const doc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'app-a', type: APPLICATION_TYPE_ID, name: 'App A' },
    { id: 'app-b', type: APPLICATION_TYPE_ID, name: 'App B' },
    { id: 'api-a', type: API_TYPE_ID, name: 'API A', parent: 'app-a' },
  ],
  relations: [{ id: 'rel-1', type: CALLS_RELATION_ID, from: 'api-a', to: 'app-b' }],
};

const withView = (source: SemanticDocument, expanded?: Record<string, boolean>) => ({
  ...source,
  view: expanded
    ? {
        kind: 'semantic-diagram-view' as const,
        version: 2 as const,
        nodesById: Object.fromEntries(
          Object.entries(expanded).map(([id, value]) => [id, { expanded: value }]),
        ),
      }
    : undefined,
});

const buildScene = (source: SemanticDocument) => {
  const graph = buildGraphModel(source, schema);
  const viewState = compileDiagramViewState({ doc: source, schema });
  return {
    graph,
    scene: buildLayoutResult({ graph, viewState }),
  };
};

const buildPresentation = (params: { scene: ReturnType<typeof buildLayoutResult> }) => {
  const { scene } = params;
  return buildStaticCanvasPresentation({
    scene,
  });
};

const buildSimpleSnapshot = (label: string): CanvasRenderSnapshot => ({
  nodes: [
    {
      id: 'node-1',
      kind: 'entity',
      matched: false,
      rect: { x: 0, y: 0, width: 120, height: 64 },
      opacity: 1,
      contentScale: 1,
      content: {
        label,
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

const buildSimpleNode = (label: string) => {
  const [node] = buildSimpleSnapshot(label).nodes;
  if (!node) {
    throw new Error('Expected simple snapshot to include a node');
  }
  return node;
};

const buildRoutedOverlayEdge = (edge: {
  id: string;
  relationId: string;
  sourceId: string;
  targetId: string;
  label?: string;
  state?: 'undecided' | 'none';
  opacity: number;
  geometry: {
    sourcePoint: { x: number; y: number };
    control1: { x: number; y: number };
    control2: { x: number; y: number };
    targetPoint: { x: number; y: number };
    path: string;
    labelAnchor: { x: number; y: number };
    sourceSide: 'left' | 'right' | 'top' | 'bottom';
    targetSide: 'left' | 'right' | 'top' | 'bottom';
  };
  labelAnchor: { x: number; y: number };
}) => ({
  id: edge.id,
  relationId: edge.relationId,
  kind: 'routed' as const,
  sourceId: edge.sourceId,
  targetId: edge.targetId,
  label: edge.label,
  state: edge.state,
  matched: false,
  geometry: edge.geometry,
  path: edge.geometry.path,
  labelAnchor: edge.labelAnchor,
  opacity: edge.opacity,
  solidOverNodeIds: [],
});

const emptySnapshot = (): CanvasRenderSnapshot => ({
  nodes: [],
  overlayEdges: [],
});

const emptyTimedPlan: TimedTransitionPlan = {
  totalDuration: 100,
  basePositions: {},
  targetPositions: {},
  nodeTimings: new Map(),
  childFadeByParent: new Map(),
  edgePlans: [],
};

const emptyTimedSequence: TimedTransitionSequence = {
  totalDuration: 100,
  stepWindows: new Map(),
};

const emptyPlanningAdvisory: TransitionPlanningAdvisory = {
  direction: 'in' as const,
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

describe('transition overlay', () => {
  it('interpolates node frames and edge geometry from start to end', () => {
    const fromDoc = withView(doc, {});
    const toDoc = withView(doc, { 'app-a': true });
    const from = buildScene(fromDoc).scene;
    const to = buildScene(toDoc).scene;
    const planningAdvisory = buildTransitionPlanningAdvisory({
      direction: 'in',
      fromTree: from.tree,
      toTree: to.tree,
      fromEdges: from.edges,
      toEdges: to.edges,
    });
    const timedSequence = buildTimedTransitionSequence({
      planningAdvisory,
    });
    const timedPlan = buildTimedTransitionPlan({
      planningAdvisory,
      timedSequence,
    });
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 100,
      duration: 400,
      planningAdvisory,
      timedPlan,
      timedSequence,
      fromPresentation: buildPresentation({
        scene: from,
      }),
      toPresentation: buildPresentation({
        scene: to,
      }),
    });
    const startFrame = resolveTransitionOverlayFrame(overlay, 100);
    const endFrame = resolveTransitionOverlayFrame(overlay, 500);
    const apiStart = startFrame.nodes.find((node) => node.id === 'api-a');
    const apiEnd = endFrame.nodes.find((node) => node.id === 'api-a');
    const relStart = startFrame.edges.find((edge) => edge.id === 'rel-1:api-a->app-b');
    const relEnd = endFrame.edges.find((edge) => edge.id === 'rel-1:api-a->app-b');
    expect(apiStart).toBeUndefined();
    expect(apiEnd).toBeDefined();
    expect(relStart).toBeUndefined();
    expect(relEnd).toBeDefined();
    expect(overlay.overlayEdges).toEqual([]);
  });

  it('round-trips local edges through captured overlay snapshots', () => {
    const localDoc = withView(
      {
        version: '1',
        schemaRefs: [],
        entities: [
          { id: 'group-a', type: CORE_GROUP_TYPE_ID, name: 'Group A' },
          { id: 'api-left', type: API_TYPE_ID, name: 'API Left', parent: 'group-a' },
          { id: 'api-right', type: API_TYPE_ID, name: 'API Right', parent: 'group-a' },
        ],
        relations: [
          { id: 'rel-local', type: CALLS_RELATION_ID, from: 'api-left', to: 'api-right' },
        ],
      },
      { 'group-a': true },
    );
    const { scene } = buildScene(localDoc);
    const presentation = buildPresentation({ scene });
    const planningAdvisory = buildTransitionPlanningAdvisory({
      direction: 'in',
      fromTree: scene.tree,
      toTree: scene.tree,
      fromEdges: scene.edges,
      toEdges: scene.edges,
    });
    const timedSequence = buildTimedTransitionSequence({
      planningAdvisory,
    });
    const timedPlan = buildTimedTransitionPlan({
      planningAdvisory,
      timedSequence,
    });
    const state = buildTransitionOverlayState({
      id: 7,
      startedAt: 100,
      duration: 1,
      planningAdvisory,
      timedPlan,
      timedSequence,
      fromPresentation: presentation,
      toPresentation: presentation,
    });
    const frame = resolveTransitionOverlayFrame(state, 101);
    const snapshot = captureTransitionOverlaySnapshot({ state, frame });
    const scopeNode = snapshot.nodes.find((node) => node.id === 'group-a');
    const localEdge = snapshot.overlayEdges.find((edge) => edge.relationId === 'rel-local');

    expect(scopeNode).toBeDefined();
    expect(localEdge).toMatchObject({
      relationId: 'rel-local',
      kind: 'routed',
      scopeId: undefined,
      sourceId: 'api-left',
      targetId: 'api-right',
    });
    expect(snapshot.overlayEdges).toHaveLength(1);
  });

  it('splits same-id endpoint reroutes into fade-out and fade-in tracks instead of morphing', () => {
    const buildNode = (id: string, x: number, y: number) => ({
      ...buildSimpleNode(id),
      id,
      rect: { x, y, width: 120, height: 64 },
      controls: {
        ...buildSimpleNode(id).controls,
        targetId: id,
      },
      content: {
        ...buildSimpleNode(id).content,
        label: id,
      },
    });

    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: emptyTimedPlan,
      timedSequence: emptyTimedSequence,
      fromPresentation: {
        nodes: [buildNode('A', 0, 0), buildNode('B', 160, 0), buildNode('X', 360, 0)],
        overlayEdges: [
          buildRoutedOverlayEdge({
            id: 'rel-1:fixed',
            relationId: 'rel-1',
            sourceId: 'B',
            targetId: 'X',
            opacity: 1,
            geometry: {
              sourcePoint: { x: 280, y: 32 },
              control1: { x: 310, y: 32 },
              control2: { x: 330, y: 32 },
              targetPoint: { x: 360, y: 32 },
              path: 'M 280,32 C 310,32 330,32 360,32',
              labelAnchor: { x: 320, y: 24 },
              sourceSide: 'right',
              targetSide: 'left',
            },
            labelAnchor: { x: 320, y: 24 },
            label: 'reads',
          }),
        ],
      },
      toPresentation: {
        nodes: [buildNode('A', 0, 0), buildNode('B', 160, 0), buildNode('X', 360, 0)],
        overlayEdges: [
          buildRoutedOverlayEdge({
            id: 'rel-1:fixed',
            relationId: 'rel-1',
            sourceId: 'A',
            targetId: 'X',
            opacity: 1,
            geometry: {
              sourcePoint: { x: 120, y: 32 },
              control1: { x: 200, y: 32 },
              control2: { x: 280, y: 32 },
              targetPoint: { x: 360, y: 32 },
              path: 'M 120,32 C 200,32 280,32 360,32',
              labelAnchor: { x: 240, y: 24 },
              sourceSide: 'right',
              targetSide: 'left',
            },
            labelAnchor: { x: 240, y: 24 },
            label: 'reads',
          }),
        ],
      },
    });

    expect(overlay.edges).toHaveLength(2);

    const startFrame = resolveTransitionOverlayFrame(overlay, 0);
    const midFrame = resolveTransitionOverlayFrame(overlay, 50);
    const endFrame = resolveTransitionOverlayFrame(overlay, 100);

    expect(startFrame.edges).toHaveLength(1);
    expect(startFrame.edges[0]).toMatchObject({
      relationId: 'rel-1',
      sourceId: 'B',
      targetId: 'X',
    });
    expect(midFrame.edges).toHaveLength(0);
    expect(endFrame.edges).toHaveLength(1);
    expect(endFrame.edges[0]).toMatchObject({
      relationId: 'rel-1',
      sourceId: 'A',
      targetId: 'X',
    });
  });

  it('freezes stable routed edges outside endpoint movement windows', () => {
    const edgeGeometry = {
      sourcePoint: { x: 120, y: 32 },
      control1: { x: 200, y: 32 },
      control2: { x: 280, y: 32 },
      targetPoint: { x: 360, y: 32 },
      path: 'M 120,32 C 200,32 280,32 360,32',
      labelAnchor: { x: 240, y: 24 },
      sourceSide: 'right' as const,
      targetSide: 'left' as const,
    };
    const fromPresentation = {
      nodes: [
        {
          ...buildSimpleNode('A'),
          id: 'A',
          controls: { ...buildSimpleNode('A').controls, targetId: 'A' },
        },
        {
          ...buildSimpleNode('X'),
          id: 'X',
          controls: { ...buildSimpleNode('X').controls, targetId: 'X' },
          rect: { x: 360, y: 0, width: 120, height: 64 },
        },
      ],
      overlayEdges: [
        buildRoutedOverlayEdge({
          id: 'rel-1:A->X',
          relationId: 'rel-1',
          sourceId: 'A',
          targetId: 'X',
          opacity: 1,
          geometry: edgeGeometry,
          labelAnchor: edgeGeometry.labelAnchor,
          label: 'reads',
        }),
      ],
    } satisfies CanvasRenderSnapshot;
    const toPresentation = {
      nodes: [
        {
          ...buildSimpleNode('A'),
          id: 'A',
          controls: { ...buildSimpleNode('A').controls, targetId: 'A' },
          rect: { x: 100, y: 0, width: 220, height: 64 },
        },
        {
          ...buildSimpleNode('X'),
          id: 'X',
          controls: { ...buildSimpleNode('X').controls, targetId: 'X' },
          rect: { x: 360, y: 0, width: 120, height: 64 },
        },
      ],
      overlayEdges: [
        buildRoutedOverlayEdge({
          id: 'rel-1:A->X',
          relationId: 'rel-1',
          sourceId: 'A',
          targetId: 'X',
          opacity: 1,
          geometry: {
            ...edgeGeometry,
            sourcePoint: { x: 320, y: 32 },
            control1: { x: 310, y: 32 },
            control2: { x: 335, y: 32 },
            path: 'M 320,32 C 310,32 335,32 360,32',
            labelAnchor: { x: 340, y: 24 },
          },
          labelAnchor: { x: 340, y: 24 },
          label: 'reads',
        }),
      ],
    } satisfies CanvasRenderSnapshot;
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: {
        ...emptyTimedPlan,
        nodeTimings: new Map([
          [
            'A',
            {
              moveX: { start: 0.2, end: 0.5 },
              resizeX: { start: 0.5, end: 0.8 },
            },
          ],
        ]),
      },
      timedSequence: emptyTimedSequence,
      fromPresentation,
      toPresentation,
    });

    const beforeMove = resolveTransitionOverlayFrame(overlay, 10);
    const duringMove = resolveTransitionOverlayFrame(overlay, 35);
    const duringResize = resolveTransitionOverlayFrame(overlay, 65);
    const afterMove = resolveTransitionOverlayFrame(overlay, 80);
    const staticFrame = resolveTransitionOverlayFrame(
      buildTransitionOverlayState({
        id: 2,
        startedAt: 0,
        duration: 1,
        planningAdvisory: emptyPlanningAdvisory,
        timedPlan: emptyTimedPlan,
        timedSequence: emptyTimedSequence,
        fromPresentation: toPresentation,
        toPresentation: toPresentation,
      }),
      1,
    );

    expect(beforeMove.edges).toHaveLength(1);
    expect(beforeMove.edges[0]?.geometry.sourcePoint.x).toBeCloseTo(120, 4);
    expect(duringMove.edges).toHaveLength(1);
    expect(duringMove.edges[0]?.geometry.sourcePoint.x).toBeCloseTo(170, 4);
    expect(duringResize.edges).toHaveLength(1);
    expect(duringResize.edges[0]?.geometry.sourcePoint.x).toBeCloseTo(220, 4);
    expect(afterMove.edges).toHaveLength(1);
    expect(afterMove.edges[0]?.geometry.sourcePoint.x).toBeCloseTo(220, 4);
    expect(staticFrame.edges).toHaveLength(1);
    expect(staticFrame.edges[0]?.geometry.sourcePoint.x).toBeCloseTo(320, 4);
  });

  it('switches node views from the sampled frame instead of pinning an endpoint view', () => {
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: emptyTimedPlan,
      timedSequence: emptyTimedSequence,
      fromPresentation: buildSimpleSnapshot('Start'),
      toPresentation: buildSimpleSnapshot('End'),
    });

    const startFrame = resolveTransitionOverlayFrame(overlay, 0);
    const switchedFrame = resolveTransitionOverlayFrame(overlay, 60);

    expect(startFrame.nodes[0]?.view.content.label).toBe('Start');
    expect(switchedFrame.nodes[0]?.view.content.label).toBe('End');
  });

  it('can freeze shared node geometry while endpoint views settle', () => {
    const fromPresentation = buildSimpleSnapshot('Start');
    const toPresentation = {
      ...buildSimpleSnapshot('End'),
      nodes: buildSimpleSnapshot('End').nodes.map((node) => ({
        ...node,
        rect: { x: 240, y: 120, width: 180, height: 80 },
      })),
    };
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      sharedNodeGeometry: 'freeze-from',
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: emptyTimedPlan,
      timedSequence: emptyTimedSequence,
      fromPresentation,
      toPresentation,
    });

    const midFrame = resolveTransitionOverlayFrame(overlay, 50);
    const endFrame = resolveTransitionOverlayFrame(overlay, 100);

    expect(midFrame.nodes[0]?.rect).toEqual(fromPresentation.nodes[0]?.rect);
    expect(endFrame.nodes[0]?.rect).toEqual(fromPresentation.nodes[0]?.rect);
    expect(endFrame.nodes[0]?.view.content.label).toBe('End');
  });

  it('holds end-only controls until the sequencer-owned appear step completes', () => {
    const planningAdvisory: TransitionPlanningAdvisory = {
      ...emptyPlanningAdvisory,
      sequence: {
        ...emptyPlanningAdvisory.sequence,
        steps: [
          {
            id: '0:grow',
            depth: 0,
            kind: 'grow',
            order: 0,
          },
        ],
        controlSwitchAdvisories: new Map([
          [
            'node-1',
            {
              id: 'node-1',
              appearAtStepId: '0:grow',
              childGroupControlsAppearAtStepId: '0:grow',
            },
          ],
        ]),
      },
    };
    const timedSequence: TimedTransitionSequence = {
      totalDuration: 100,
      stepWindows: new Map([
        [
          '0:grow',
          {
            start: 0.05,
            end: 0.8,
          },
        ],
      ]),
    };

    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory,
      timedPlan: emptyTimedPlan,
      timedSequence,
      fromPresentation: buildSimpleSnapshot('Start'),
      toPresentation: {
        ...buildSimpleSnapshot('End'),
        nodes: [
          {
            ...buildSimpleNode('End'),
            controls: {
              ...buildSimpleNode('End').controls,
              showChildGroupControls: true,
              canCollapseChildGroups: true,
            },
          },
        ],
      },
    });

    const beforeSwitch = resolveTransitionOverlayFrame(overlay, 20);
    const afterSwitch = resolveTransitionOverlayFrame(overlay, 90);

    expect(beforeSwitch.nodes[0]?.view.controls.showChildGroupControls).toBe(false);
    expect(afterSwitch.nodes[0]?.view.controls.showChildGroupControls).toBe(true);
  });

  it('drops disappearing controls at the sequencer-owned disappear step start', () => {
    const planningAdvisory: TransitionPlanningAdvisory = {
      ...emptyPlanningAdvisory,
      sequence: {
        ...emptyPlanningAdvisory.sequence,
        steps: [
          {
            id: '0:shrink',
            depth: 0,
            kind: 'shrink',
            order: 0,
          },
        ],
        controlSwitchAdvisories: new Map([
          [
            'node-1',
            {
              id: 'node-1',
              disappearAtStepId: '0:shrink',
              childGroupControlsDisappearAtStepId: '0:shrink',
            },
          ],
        ]),
      },
    };
    const timedSequence: TimedTransitionSequence = {
      totalDuration: 100,
      stepWindows: new Map([
        [
          '0:shrink',
          {
            start: 0.25,
            end: 0.75,
          },
        ],
      ]),
    };

    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory,
      timedPlan: emptyTimedPlan,
      timedSequence,
      fromPresentation: {
        ...buildSimpleSnapshot('Start'),
        nodes: [
          {
            ...buildSimpleNode('Start'),
            controls: {
              ...buildSimpleNode('Start').controls,
              showChildGroupControls: true,
              canCollapseChildGroups: true,
            },
          },
        ],
      },
      toPresentation: buildSimpleSnapshot('End'),
    });

    const beforeSwitch = resolveTransitionOverlayFrame(overlay, 20);
    const afterSwitch = resolveTransitionOverlayFrame(overlay, 30);

    expect(beforeSwitch.nodes[0]?.view.controls.showChildGroupControls).toBe(true);
    expect(afterSwitch.nodes[0]?.view.controls.showChildGroupControls).toBe(false);
  });

  it('keeps persistent nodes on their source view until their staged motion finishes', () => {
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: {
        ...emptyTimedPlan,
        nodeTimings: new Map([
          [
            'node-1',
            {
              moveX: { start: 0, end: 0.2 },
              moveY: { start: 0.4, end: 0.6 },
            },
          ],
        ]),
      },
      timedSequence: emptyTimedSequence,
      fromPresentation: buildSimpleSnapshot('Start'),
      toPresentation: {
        ...buildSimpleSnapshot('End'),
        nodes: [
          {
            ...buildSimpleNode('End'),
            rect: { x: 100, y: 100, width: 120, height: 64 },
          },
        ],
      },
    });

    const midFrame = resolveTransitionOverlayFrame(overlay, 50);
    const finishedFrame = resolveTransitionOverlayFrame(overlay, 70);

    expect(midFrame.nodes[0]?.view.content.label).toBe('Start');
    expect(finishedFrame.nodes[0]?.view.content.label).toBe('End');
  });

  it('keeps persistent children above entering parents during scope exit fades', () => {
    const buildLayeredNode = (params: {
      id: string;
      label: string;
      zIndex: number;
      parentId?: string;
      rect: { x: number; y: number; width: number; height: number };
    }) => {
      const node = buildSimpleNode(params.label);
      return {
        ...node,
        id: params.id,
        parentId: params.parentId,
        zIndex: params.zIndex,
        rect: params.rect,
        controls: {
          ...node.controls,
          targetId: params.id,
        },
        content: {
          ...node.content,
          label: params.label,
        },
      };
    };
    const fromPresentation = {
      nodes: [
        buildLayeredNode({
          id: 'child',
          label: 'Scoped child',
          zIndex: 1,
          rect: { x: 20, y: 20, width: 120, height: 64 },
        }),
      ],
      overlayEdges: [],
    } satisfies CanvasRenderSnapshot;
    const toPresentation = {
      nodes: [
        buildLayeredNode({
          id: 'child',
          label: 'Settled child',
          parentId: 'parent',
          zIndex: 8,
          rect: { x: 40, y: 40, width: 120, height: 64 },
        }),
        buildLayeredNode({
          id: 'parent',
          label: 'Entering parent',
          zIndex: 4,
          rect: { x: 0, y: 0, width: 220, height: 140 },
        }),
      ],
      overlayEdges: [],
    } satisfies CanvasRenderSnapshot;
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: emptyTimedPlan,
      timedSequence: emptyTimedSequence,
      fromPresentation,
      toPresentation,
    });

    const midFrame = resolveTransitionOverlayFrame(overlay, 25);
    const child = midFrame.nodes.find((node) => node.id === 'child');
    const parent = midFrame.nodes.find((node) => node.id === 'parent');

    expect(child?.view.content.label).toBe('Scoped child');
    expect(child?.zIndex).toBe(8);
    expect(child?.view.zIndex).toBe(8);
    expect(parent?.zIndex).toBe(4);
    expect(parent?.view.zIndex).toBe(4);
  });

  it('keeps expanded content hidden until growth windows finish', () => {
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: {
        ...emptyTimedPlan,
        nodeTimings: new Map([
          [
            'node-1',
            {
              resizeX: { start: 0.1, end: 0.75 },
              resizeY: { start: 0.2, end: 0.8 },
            },
          ],
        ]),
      },
      timedSequence: emptyTimedSequence,
      fromPresentation: buildSimpleSnapshot('Start'),
      toPresentation: {
        ...buildSimpleSnapshot('End'),
        nodes: [
          {
            ...buildSimpleNode('End'),
            rect: { x: 0, y: 0, width: 260, height: 180 },
          },
        ],
      },
    });

    const earlyFrame = resolveTransitionOverlayFrame(overlay, 20);
    const completedResizeFrame = resolveTransitionOverlayFrame(overlay, 90);

    expect(earlyFrame.nodes[0]?.view.content.label).toBe('Start');
    expect(completedResizeFrame.nodes[0]?.view.content.label).toBe('End');
  });

  it('pins fade-in nodes to their endpoint geometry when no move or resize windows exist', () => {
    const finalRect = { x: 220, y: 140, width: 180, height: 96 };
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: {
        ...emptyTimedPlan,
        nodeTimings: new Map([
          [
            'node-1',
            {
              fade: { start: 0, end: 1 },
              fadeMode: 'in',
            },
          ],
        ]),
      },
      timedSequence: emptyTimedSequence,
      fromPresentation: emptySnapshot(),
      toPresentation: {
        ...emptySnapshot(),
        nodes: [
          {
            ...buildSimpleNode('End'),
            rect: finalRect,
          },
        ],
      },
    });

    const midFrame = resolveTransitionOverlayFrame(overlay, 50);

    expect(midFrame.nodes[0]?.rect).toEqual(finalRect);
  });

  it('pins fade-out nodes to their source geometry when no move or resize windows exist', () => {
    const initialRect = { x: 40, y: 80, width: 180, height: 96 };
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: {
        ...emptyTimedPlan,
        nodeTimings: new Map([
          [
            'node-1',
            {
              fade: { start: 0, end: 1 },
              fadeMode: 'out',
            },
          ],
        ]),
      },
      timedSequence: emptyTimedSequence,
      fromPresentation: {
        ...emptySnapshot(),
        nodes: [
          {
            ...buildSimpleNode('Start'),
            rect: initialRect,
          },
        ],
      },
      toPresentation: emptySnapshot(),
    });

    const midFrame = resolveTransitionOverlayFrame(overlay, 50);

    expect(midFrame.nodes[0]?.rect).toEqual(initialRect);
  });

  it('respects staged axis windows instead of front-loading the whole sequence', () => {
    const overlay = buildTransitionOverlayState({
      id: 1,
      startedAt: 0,
      duration: 100,
      planningAdvisory: emptyPlanningAdvisory,
      timedPlan: {
        ...emptyTimedPlan,
        nodeTimings: new Map([
          [
            'node-1',
            {
              moveX: { start: 0, end: 0.2 },
              moveY: { start: 0.4, end: 0.6 },
            },
          ],
        ]),
      },
      timedSequence: emptyTimedSequence,
      fromPresentation: {
        ...emptySnapshot(),
        nodes: [
          {
            ...buildSimpleNode('Start'),
            rect: { x: 0, y: 0, width: 120, height: 64 },
          },
        ],
      },
      toPresentation: {
        ...emptySnapshot(),
        nodes: [
          {
            ...buildSimpleNode('End'),
            rect: { x: 100, y: 100, width: 120, height: 64 },
          },
        ],
      },
    });

    const earlyFrame = resolveTransitionOverlayFrame(overlay, 10);
    const midFrame = resolveTransitionOverlayFrame(overlay, 50);

    expect(earlyFrame.nodes[0]?.rect.x).toBeCloseTo(50, 4);
    expect(earlyFrame.nodes[0]?.rect.y).toBeCloseTo(0, 4);
    expect(midFrame.nodes[0]?.rect.x).toBeCloseTo(100, 4);
    expect(midFrame.nodes[0]?.rect.y).toBeCloseTo(50, 4);
  });
});
