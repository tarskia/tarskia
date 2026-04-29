import { describe, expect, it } from 'vitest';
import { buildQualifiedSchemaObjectId, CORE_GROUP_TYPE_ID } from '../../../model/schema-ids';
import type { SchemaModule, SemanticDocument } from '../../../model/types';
import { compileDiagramViewState } from '../../../semantic';
import { buildGraphModel } from '../../rendering/graph/graph-model';
import { buildLayoutResult } from '../../rendering/layout/layout-pipeline';
import { buildStaticCanvasPresentation } from '../../rendering/presentation/presentation';
import { adaptPresentationToReactFlow } from './adapter';
import type { CanvasInteractionBindings } from './types';

const INTERACTION_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'interaction');
const DATA_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'data');
const APPLICATION_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'application');
const API_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'api');
const TABLE_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'table');
const CALLS_RELATION_ID = buildQualifiedSchemaObjectId('user/test', 'relations', 'calls');

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  tags: [
    { id: INTERACTION_TAG_ID, label: 'Interaction', color: '#ff0000' },
    { id: DATA_TAG_ID, label: 'Data', color: '#00ff00' },
  ],
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
      id: TABLE_TYPE_ID,
      label: 'Table',
      defaultTags: [DATA_TAG_ID],
      display: { primaryTag: DATA_TAG_ID },
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
    { id: 'table-a', type: TABLE_TYPE_ID, name: 'orders' },
  ],
  relations: [{ id: 'rel-1', type: CALLS_RELATION_ID, from: 'api-a', to: 'app-b' }],
};

const withView = (
  source: SemanticDocument,
  params: { expanded?: Record<string, boolean>; scopeRootId?: string } = {},
): SemanticDocument => ({
  ...source,
  view:
    params.expanded || params.scopeRootId
      ? {
          kind: 'semantic-diagram-view',
          version: 2,
          scopeRootId: params.scopeRootId,
          nodesById: params.expanded
            ? Object.fromEntries(
                Object.entries(params.expanded).map(([id, expanded]) => [id, { expanded }]),
              )
            : undefined,
        }
      : undefined,
});

const buildScene = (source: SemanticDocument) => {
  const graph = buildGraphModel(source, schema);
  const viewState = compileDiagramViewState({ doc: source, schema });
  const scene = buildLayoutResult({ graph, viewState, layout: source.view?.layout });
  return { graph, scene };
};

const noopBindings: CanvasInteractionBindings = {
  onZoomTrigger: () => false,
  onExpandDetails: () => {},
  onCollapseDetails: () => {},
  onExpandChildGroups: () => {},
  onCollapseChildGroups: () => {},
  onEdgeLabelClick: () => {},
  onSelectNode: () => {},
  onSelectEdge: () => {},
};

const buildHostState = () => {
  const viewDoc = withView(doc, { expanded: { 'app-a': true } });
  const { graph, scene } = buildScene(viewDoc);
  const presentation = buildStaticCanvasPresentation({
    graph,
    scene,
  });
  return {
    presentation,
    host: adaptPresentationToReactFlow({
      presentation,
      bindings: noopBindings,
      nodeControlsById: new Map([
        [
          'app-a',
          {
            selected: true,
            disableControlActions: false,
            hideLocalEdgeLabels: false,
            highlightSourceHandle: false,
            highlightTargetHandle: false,
          },
        ],
      ]),
      edgeControlsById: new Map([
        [
          'rel-1:api-a->app-b',
          {
            selected: true,
            hideLabel: true,
          },
        ],
      ]),
    }),
  };
};

describe('adaptPresentationToReactFlow', () => {
  it('emits absolute world-space Flow positions for settled nodes without host nesting', () => {
    const { presentation, host } = buildHostState();
    const appNode = presentation.nodes.find((node) => node.id === 'app-a');
    const apiNode = presentation.nodes.find((node) => node.id === 'api-a');
    const hostAppNode = host.nodes.find((node) => node.id === 'app-a');
    const hostApiNode = host.nodes.find((node) => node.id === 'api-a');

    expect(appNode).toBeDefined();
    expect(apiNode).toBeDefined();
    expect(hostAppNode?.parentNode).toBeUndefined();
    expect(hostApiNode?.parentNode).toBeUndefined();
    expect(hostAppNode?.position).toEqual({
      x: appNode?.rect.x ?? 0,
      y: appNode?.rect.y ?? 0,
    });
    expect(hostApiNode?.position).toEqual({
      x: apiNode?.rect.x ?? 0,
      y: apiNode?.rect.y ?? 0,
    });
  });

  it('emits selection highlight CSS vars from renderer-owned style tokens', () => {
    const { host } = buildHostState();

    const appNode = host.nodes.find((node) => node.id === 'app-a');
    const appStyle = (appNode?.style ?? {}) as Record<string, string>;
    expect(appStyle['--node-selection-ring']).toContain('hsla(0, 60%, 70%');
    expect(appStyle['--node-selection-glow']).toBe('transparent');
    expect(appStyle['--node-selection-fill']).toContain('hsla(0, 45%, 50%');

    const dataNode = host.nodes.find((node) => node.id === 'table-a');
    const dataStyle = (dataNode?.style ?? {}) as Record<string, string>;
    expect(dataStyle['--node-selection-ring']).toContain('hsla(120, 60%, 70%');
    expect(dataStyle['--node-selection-glow']).toBe('transparent');
    expect(dataStyle['--node-selection-fill']).toContain('hsla(120, 45%, 50%');
  });

  it('only adds host controls at the boundary', () => {
    const { host } = buildHostState();
    const appNode = host.nodes.find((node) => node.id === 'app-a');
    const overlayEdge = host.overlayEdges.find((item) => item.id === 'rel-1:api-a->app-b');

    expect(appNode?.selected).toBe(true);
    expect(appNode?.data.controls.selected).toBe(true);
    expect(appNode?.data.controls.highlightSourceHandle).toBe(false);
    expect(appNode?.data.controls.highlightTargetHandle).toBe(false);
    expect(overlayEdge?.selected).toBe(true);
    expect(overlayEdge?.hideLabel).toBe(true);
  });

  it('renders selected overlay edges last so they sit on top', () => {
    const viewDoc = withView(
      {
        ...doc,
        relations: [
          ...doc.relations,
          { id: 'rel-2', type: CALLS_RELATION_ID, from: 'app-a', to: 'table-a' },
        ],
      },
      { expanded: { 'app-a': true } },
    );
    const { graph, scene } = buildScene(viewDoc);
    const presentation = buildStaticCanvasPresentation({
      graph,
      scene,
    });
    const host = adaptPresentationToReactFlow({
      presentation,
      bindings: noopBindings,
      nodeControlsById: new Map(),
      edgeControlsById: new Map([
        [
          'rel-1:api-a->app-b',
          {
            selected: true,
            hideLabel: false,
          },
        ],
      ]),
    });

    expect(host.overlayEdges.at(-1)?.id).toBe('rel-1:api-a->app-b');
  });

  it('forwards sibling overlay edges without special local scope metadata or label hiding', () => {
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
      { expanded: { 'group-a': true } },
    );
    const { graph, scene } = buildScene(localDoc);
    const presentation = buildStaticCanvasPresentation({
      graph,
      scene,
    });
    const localEdgeId = presentation.overlayEdges.find(
      (edge) => edge.relationId === 'rel-local',
    )?.id;
    const host = adaptPresentationToReactFlow({
      presentation,
      bindings: noopBindings,
      nodeControlsById: new Map([
        [
          'group-a',
          {
            selected: false,
            disableControlActions: false,
            hideLocalEdgeLabels: true,
            highlightSourceHandle: false,
            highlightTargetHandle: false,
          },
        ],
      ]),
      edgeControlsById: new Map([
        [
          localEdgeId ?? 'rel-local',
          {
            selected: true,
            hideLabel: true,
          },
        ],
      ]),
    });

    const localOverlay = host.overlayEdges.find((edge) => edge.relationId === 'rel-local');

    expect(localOverlay).toMatchObject({
      relationId: 'rel-local',
      kind: 'routed',
      selected: true,
      hideLabel: true,
    });
  });

  it('keeps focused subtree nodes in absolute world space even when the semantic parent is omitted', () => {
    const viewDoc = withView(doc, {
      expanded: { 'app-a': true },
      scopeRootId: 'app-a',
    });
    const { graph, scene } = buildScene(viewDoc);
    const presentation = buildStaticCanvasPresentation({
      graph,
      scene,
    });
    const host = adaptPresentationToReactFlow({
      presentation,
      bindings: noopBindings,
      nodeControlsById: new Map(),
      edgeControlsById: new Map(),
    });

    const apiNode = presentation.nodes.find((node) => node.id === 'api-a');
    const hostApiNode = host.nodes.find((node) => node.id === 'api-a');
    expect(hostApiNode?.parentNode).toBeUndefined();
    expect(hostApiNode?.position).toEqual({
      x: apiNode?.rect.x ?? 0,
      y: apiNode?.rect.y ?? 0,
    });
  });

  it('keeps flattened nested nodes aligned with world-space overlay edges and presentation z-order', () => {
    const { presentation, host } = buildHostState();
    const appNode = presentation.nodes.find((node) => node.id === 'app-a');
    const apiNode = presentation.nodes.find((node) => node.id === 'api-a');
    const hostAppNode = host.nodes.find((node) => node.id === 'app-a');
    const hostApiNode = host.nodes.find((node) => node.id === 'api-a');
    const presentationOverlay = presentation.overlayEdges.find(
      (edge) => edge.relationId === 'rel-1',
    );
    const hostOverlay = host.overlayEdges.find((edge) => edge.relationId === 'rel-1');

    expect(host.nodes.every((node) => node.parentNode === undefined)).toBe(true);
    expect(hostAppNode?.position).toEqual({
      x: appNode?.rect.x ?? 0,
      y: appNode?.rect.y ?? 0,
    });
    expect(hostApiNode?.position).toEqual({
      x: apiNode?.rect.x ?? 0,
      y: apiNode?.rect.y ?? 0,
    });
    expect(hostAppNode?.zIndex).toBe(appNode?.zIndex);
    expect(hostApiNode?.zIndex).toBe(apiNode?.zIndex);
    expect(hostOverlay).toMatchObject({
      id: presentationOverlay?.id,
      kind: presentationOverlay?.kind,
      path: presentationOverlay?.path,
      labelAnchor: presentationOverlay?.labelAnchor,
      geometry: presentationOverlay?.geometry,
      solidOverNodeIds: presentationOverlay?.solidOverNodeIds,
    });
  });

  it('keeps boundary outline styling for focus scaffold shells', () => {
    const focusDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'ordersdb', type: APPLICATION_TYPE_ID, name: 'Orders DB' },
        { id: 'table-group', type: CORE_GROUP_TYPE_ID, name: 'Core tables', parent: 'ordersdb' },
        { id: 'orders', type: TABLE_TYPE_ID, name: 'orders', parent: 'table-group' },
        { id: 'customers', type: TABLE_TYPE_ID, name: 'customers', parent: 'table-group' },
      ],
      relations: [],
    };
    const viewDoc = withView(focusDoc, { scopeRootId: 'ordersdb' });
    const { graph, scene } = (() => {
      const built = buildScene(viewDoc);
      return {
        ...built,
        scene: buildLayoutResult({
          graph: built.graph,
          viewState: compileDiagramViewState({ doc: viewDoc, schema }),
          layout: viewDoc.view?.layout,
          canvasSize: { width: 1600, height: 900 },
        }),
      };
    })();
    const presentation = buildStaticCanvasPresentation({
      graph,
      scene,
    });
    const host = adaptPresentationToReactFlow({
      presentation,
      bindings: noopBindings,
      nodeControlsById: new Map(),
      edgeControlsById: new Map(),
    });

    const shellNode = host.nodes.find((node) => node.id === 'table-group');
    const shellPresentationNode = presentation.nodes.find((node) => node.id === 'table-group');
    expect(shellNode?.data.view.content.focusShell).toBe(true);
    expect(shellNode?.parentNode).toBeUndefined();
    expect(shellNode?.position).toEqual({
      x: shellPresentationNode?.rect.x ?? 0,
      y: shellPresentationNode?.rect.y ?? 0,
    });
    expect((shellNode?.style as Record<string, string> | undefined)?.['--node-bg']).toBe(
      'transparent',
    );
    expect((shellNode?.style as Record<string, string> | undefined)?.['--node-border']).toBe(
      '1px solid transparent',
    );
    expect((shellNode?.style as Record<string, string> | undefined)?.pointerEvents).toBe('none');
    expect(shellNode?.selectable).toBe(false);
    expect(shellNode?.connectable).toBe(false);
  });
});
