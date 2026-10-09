import {
  buildQualifiedSchemaObjectId,
  buildSemanticIndex,
  CORE_GROUP_TYPE_ID,
  compileDiagramViewState,
  type SchemaModule,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { buildLayoutResult } from '../layout/layout-pipeline';
import {
  buildStaticCanvasPresentation,
  type CanvasRenderSnapshot,
} from '../presentation/presentation';
import {
  buildTransitionFrameState,
  captureTransitionFrameSnapshot,
  resolveAnimationFrame,
} from './overlay';

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
        version: 3 as const,
        nodesById: Object.fromEntries(
          Object.entries(expanded).map(([id, value]) => [id, { expanded: value }]),
        ),
      }
    : undefined,
});

const buildScene = (source: SemanticDocument) => {
  const graph = buildSemanticIndex(source, schema);
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

describe('three-phase structural frames', () => {
  const transition = (
    fromPresentation: CanvasRenderSnapshot,
    toPresentation: CanvasRenderSnapshot,
    settleDuration = 0,
  ) =>
    buildTransitionFrameState({
      id: 1,
      startedAt: 0,
      duration: 100,
      settleDuration,
      fromPresentation,
      toPresentation,
    });
  it('interpolates all rectangle coordinates with the same global easing and exact endpoints', () => {
    const from = buildSimpleSnapshot('Before');
    const to = buildSimpleSnapshot('After');
    to.nodes[0].rect = { x: 100, y: 200, width: 240, height: 128 };
    const state = transition(from, to);
    expect(resolveAnimationFrame(state, 0).nodes[0].rect).toEqual(from.nodes[0].rect);
    for (const [key, value] of Object.entries({ x: 50, y: 100, width: 180, height: 96 }))
      expect(resolveAnimationFrame(state, 50).nodes[0].rect[key as 'x']).toBeCloseTo(value);
    expect(
      captureTransitionFrameSnapshot({ state, frame: resolveAnimationFrame(state, 100) }).nodes,
    ).toEqual(
      to.nodes.map((node) => ({
        ...node,
        zIndex: undefined,
        content: { ...node.content, childOpacity: 1 },
      })),
    );
  });
  it('grows entrants from their parent rectangle and shrinks exits back into it', () => {
    const from = buildSimpleSnapshot('Parent');
    const to = {
      ...from,
      nodes: [
        ...from.nodes,
        {
          ...buildSimpleNode('Child'),
          id: 'child',
          parentId: 'node-1',
          rect: { x: 20, y: 30, width: 50, height: 20 },
        },
      ],
    };
    const state = transition(from, to);
    const child = state.nodes.find((node) => node.id === 'child')!;
    expect(child.fromRect).toEqual(from.nodes[0].rect);
    expect(
      resolveAnimationFrame(state, 50).nodes.find((node) => node.id === 'child')?.opacity,
    ).toBeCloseTo(0.5);
    const reverse = transition(to, from);
    expect(reverse.nodes.find((node) => node.id === 'child')?.toRect).toEqual(from.nodes[0].rect);
    expect(resolveAnimationFrame(reverse, 100).nodes.map((node) => node.id)).toEqual(['node-1']);
  });
  it('keeps same-id endpoint changes attached to their own current node rectangles', () => {
    const from = buildPresentation(buildScene(withView(doc, {})));
    const to = buildPresentation(buildScene(withView(doc, { 'app-a': true })));
    const state = transition(from, to);
    for (const time of [0, 10, 50, 90, 100]) {
      const frame = resolveAnimationFrame(state, time);
      for (const edge of frame.edges) {
        const source = frame.nodes.find((node) => node.id === edge.sourceId)!;
        const target = frame.nodes.find((node) => node.id === edge.targetId)!;
        expect(source).toBeDefined();
        expect(target).toBeDefined();
        const onBorder = (point: { x: number; y: number }, rect: typeof source.rect) =>
          Math.abs(point.x - rect.x) < 0.001 ||
          Math.abs(point.x - rect.x - rect.width) < 0.001 ||
          Math.abs(point.y - rect.y) < 0.001 ||
          Math.abs(point.y - rect.y - rect.height) < 0.001;
        expect(onBorder(edge.geometry.sourcePoint, source.rect)).toBe(true);
        expect(onBorder(edge.geometry.targetPoint, target.rect)).toBe(true);
      }
    }
    expect(resolveAnimationFrame(state, 100).edges.map((edge) => edge.id)).toEqual(
      to.overlayEdges.map((edge) => edge.id),
    );
  });
  it('preserves local edge metadata through capture and retarget, including label opacity', () => {
    const from = buildPresentation(buildScene(withView(doc, {})));
    from.overlayEdges[0].kind = 'local';
    const to = {
      ...from,
      nodes: from.nodes.map((node) => ({ ...node, rect: { ...node.rect, x: node.rect.x + 100 } })),
    };
    const state = transition(from, to, 20);
    const frame = resolveAnimationFrame(state, 40);
    const captured = captureTransitionFrameSnapshot({ state, frame });
    expect(captured.overlayEdges[0].kind).toBe('local');
    const restarted = transition(captured, from, 20);
    const first = resolveAnimationFrame(restarted, 0);
    expect(first.nodes.map((node) => node.rect)).toEqual(frame.nodes.map((node) => node.rect));
    expect(first.edges[0].labelOpacity).toBe(frame.edges[0].labelOpacity);
    const structureEnd = resolveAnimationFrame(state, 80);
    expect(structureEnd.nodes.map((node) => node.rect)).toEqual(to.nodes.map((node) => node.rect));
    expect(structureEnd.edges[0].labelOpacity).toBe(0);
    expect(resolveAnimationFrame(state, 90).edges[0].labelOpacity).toBe(0.5);
    expect(resolveAnimationFrame(state, 100).edges[0].labelOpacity).toBe(1);
  });
  it('keeps retained children above entering parent chrome until their final layer settles', () => {
    const from = buildSimpleSnapshot('Child');
    from.nodes[0].zIndex = 5;
    const to = {
      ...from,
      nodes: [
        { ...from.nodes[0], zIndex: 1 },
        { ...buildSimpleNode('Parent'), id: 'parent', zIndex: 3 },
      ],
    };
    const state = transition(from, to);
    const middle = resolveAnimationFrame(state, 50);
    expect(middle.nodes.find((node) => node.id === 'node-1')?.zIndex).toBeGreaterThan(
      middle.nodes.find((node) => node.id === 'parent')!.zIndex!,
    );
    expect(
      resolveAnimationFrame(state, 100).nodes.find((node) => node.id === 'node-1')?.zIndex,
    ).toBe(1);
  });
});
