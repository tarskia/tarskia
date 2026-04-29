import { describe, expect, it } from 'vitest';
import { buildQualifiedSchemaObjectId, CORE_GROUP_TYPE_ID } from '../../../model/schema-ids';
import type { SchemaModule, SemanticDocument } from '../../../model/types';
import { compileDiagramViewState } from '../../../semantic';
import { buildGraphModel } from '../graph/graph-model';
import { buildLayoutResult } from '../layout/layout-pipeline';
import { buildBezierEdgeGeometry } from './geometry';
import { buildStaticCanvasPresentation } from './presentation';

const INTERACTION_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'interaction');
const DATA_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'data');
const INFRA_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'infra');
const APPLICATION_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'application');
const API_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'api');
const SERVICE_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'service');
const TABLE_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'table');
const NOTE_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'note');
const WORKER_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'worker');
const JOB_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'job');
const CALLS_RELATION_ID = buildQualifiedSchemaObjectId('user/test', 'relations', 'calls');
const READS_RELATION_ID = buildQualifiedSchemaObjectId('user/test', 'relations', 'reads');

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  tags: [
    { id: INTERACTION_TAG_ID, label: 'Interaction', color: '#ff0000' },
    { id: DATA_TAG_ID, label: 'Data', color: '#00ff00' },
    { id: INFRA_TAG_ID, label: 'Infra', color: '#0000ff' },
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
      id: SERVICE_TYPE_ID,
      label: 'Service',
      defaultTags: [INTERACTION_TAG_ID],
      display: {
        primaryTag: INTERACTION_TAG_ID,
        defaultSize: { width: 180, height: 72 },
      },
      properties: [
        {
          id: 'region',
          label: 'Region',
          type: 'string',
          display: {
            priority: 1,
          },
        },
        {
          id: 'replicas',
          type: 'number',
          display: {
            priority: 2,
          },
        },
      ],
    },
    {
      id: TABLE_TYPE_ID,
      label: 'Table',
      defaultTags: [DATA_TAG_ID],
      display: { primaryTag: DATA_TAG_ID },
    },
    {
      id: NOTE_TYPE_ID,
      label: 'Note',
      defaultTags: [INFRA_TAG_ID],
      display: {
        primaryTag: INFRA_TAG_ID,
        content: { kind: 'markdown', bodyPath: 'body' },
      },
      properties: [{ id: 'body', type: 'string' }],
    },
    {
      id: WORKER_TYPE_ID,
      label: 'Worker',
      defaultTags: [INTERACTION_TAG_ID],
      display: {
        primaryTag: INTERACTION_TAG_ID,
        style: { hue: 32 },
      },
    },
    {
      id: JOB_TYPE_ID,
      label: 'Job',
      defaultTags: [INTERACTION_TAG_ID],
      display: {
        primaryTag: INTERACTION_TAG_ID,
        style: { hue: 278 },
      },
    },
    {
      id: CORE_GROUP_TYPE_ID,
      label: 'Group',
      defaultTags: [INFRA_TAG_ID],
      display: { primaryTag: INFRA_TAG_ID },
    },
  ],
  relations: [
    {
      id: CALLS_RELATION_ID,
      label: 'Calls',
      shortLabel: 'call',
    },
    {
      id: READS_RELATION_ID,
      label: 'Reads',
      shortLabel: 'read',
      display: {
        flowDirection: 'reverse',
      },
    },
  ],
};

const baseDoc: SemanticDocument = {
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
  doc: SemanticDocument,
  params: {
    expanded?: Record<string, boolean>;
    scopeRootId?: string;
  } = {},
): SemanticDocument => ({
  ...doc,
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

const buildScene = (doc: SemanticDocument, canvasSize?: { width: number; height: number }) => {
  const graph = buildGraphModel(doc, schema);
  const viewState = compileDiagramViewState({ doc, schema });
  const scene = buildLayoutResult({
    graph,
    viewState,
    layout: doc.view?.layout,
    canvasSize,
  });
  return { graph, scene };
};

const buildPresentationFor = (params?: {
  doc?: SemanticDocument;
  expanded?: Record<string, boolean>;
}) => {
  const viewDoc = withView(params?.doc ?? baseDoc, {
    expanded: params?.expanded ?? {},
  });
  const { graph, scene } = buildScene(viewDoc);
  return buildStaticCanvasPresentation({
    graph,
    scene,
  });
};

describe('buildStaticCanvasPresentation', () => {
  it('renders overlay edges and node tag styling from the canonical scene', () => {
    const presentation = buildPresentationFor({
      expanded: { 'app-a': true },
    });
    const appNode = presentation.nodes.find((node) => node.id === 'app-a');
    const routedEdge = presentation.overlayEdges.find((edge) => edge.kind === 'routed');

    expect(routedEdge?.sourceId).toBe('api-a');
    expect(routedEdge?.targetId).toBe('app-b');
    expect(routedEdge?.label).toBe('call');
    expect(presentation.overlayEdges).toHaveLength(1);
    expect(presentation.overlayEdges[0]?.solidOverNodeIds).toEqual(['app-a']);
    expect(presentation.overlayEdges[0]?.solidOverNodeIds).not.toContain('api-a');
    expect(presentation.overlayEdges[0]?.solidOverNodeIds).not.toContain('app-b');
    expect(appNode?.rect).toBeDefined();

    expect(appNode?.content.primaryTagLabel).toBe('Interaction');
    expect(appNode?.style.background).toContain(
      'hsla(0, var(--node-bg-s, 38%), var(--node-bg-l-group, 18%)',
    );
  });

  it('renders reverse-flow relations using visual source and target endpoints', () => {
    const reverseDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'reader', type: APPLICATION_TYPE_ID, name: 'Reader' },
        { id: 'store', type: TABLE_TYPE_ID, name: 'Store' },
      ],
      relations: [{ id: 'rel-read', type: READS_RELATION_ID, from: 'reader', to: 'store' }],
    };

    const presentation = buildPresentationFor({
      doc: reverseDoc,
    });

    expect(presentation.overlayEdges[0]).toMatchObject({
      id: 'rel-read:reader->store',
      sourceId: 'store',
      targetId: 'reader',
      label: 'read',
    });
  });

  it('carries deterministic content occluders from layout into presentation nodes', () => {
    const listDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'group-a', type: CORE_GROUP_TYPE_ID, name: 'Group A' },
        { id: 'api-left', type: API_TYPE_ID, name: 'API Left', parent: 'group-a' },
        { id: 'api-right', type: API_TYPE_ID, name: 'API Right', parent: 'group-a' },
      ],
      relations: [],
    };

    const presentation = buildPresentationFor({
      doc: listDoc,
      expanded: { 'group-a': true },
    });
    const groupNode = presentation.nodes.find((node) => node.id === 'group-a');
    const leftNode = presentation.nodes.find((node) => node.id === 'api-left');

    expect(groupNode?.contentOccluders?.length).toBeGreaterThan(0);
    expect(groupNode?.contentOccluders).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 28 })]),
    );
    expect(leftNode?.contentOccluders?.length).toBeGreaterThan(0);
    expect(leftNode?.contentOccluders).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 14 })]),
    );
  });

  it('keeps projected collapsed endpoints on the canonical node handle instead of slotting them', () => {
    const collapsedProjectionDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'app-a', type: APPLICATION_TYPE_ID, name: 'App A' },
        { id: 'services-a', type: CORE_GROUP_TYPE_ID, name: 'Services', parent: 'app-a' },
        { id: 'service-a', type: API_TYPE_ID, name: 'Service A', parent: 'services-a' },
        { id: 'service-b', type: API_TYPE_ID, name: 'Service B', parent: 'services-a' },
        { id: 'external-a', type: API_TYPE_ID, name: 'External A' },
        { id: 'external-b', type: API_TYPE_ID, name: 'External B' },
      ],
      relations: [
        { id: 'rel-a', type: CALLS_RELATION_ID, from: 'service-a', to: 'external-a' },
        { id: 'rel-b', type: CALLS_RELATION_ID, from: 'service-b', to: 'external-b' },
      ],
    };

    const presentation = buildPresentationFor({
      doc: collapsedProjectionDoc,
      expanded: { 'app-a': true },
    });
    const servicesNode = presentation.nodes.find((node) => node.id === 'services-a');
    const firstEdge = presentation.overlayEdges.find((edge) => edge.relationId === 'rel-a');
    const secondEdge = presentation.overlayEdges.find((edge) => edge.relationId === 'rel-b');

    expect(servicesNode).toBeDefined();
    expect(firstEdge?.sourceId).toBe('services-a');
    expect(secondEdge?.sourceId).toBe('services-a');
    expect(firstEdge?.geometry.sourcePoint.y).toBe(
      servicesNode!.rect.y + servicesNode!.rect.height / 2,
    );
    expect(secondEdge?.geometry.sourcePoint.y).toBe(
      servicesNode!.rect.y + servicesNode!.rect.height / 2,
    );
  });

  it('emits sibling edges into the world-space overlay using semantic solid-over ownership', () => {
    const localDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'group-a', type: CORE_GROUP_TYPE_ID, name: 'Group A' },
        { id: 'api-left', type: API_TYPE_ID, name: 'API Left', parent: 'group-a' },
        { id: 'api-right', type: API_TYPE_ID, name: 'API Right', parent: 'group-a' },
      ],
      relations: [{ id: 'rel-local', type: CALLS_RELATION_ID, from: 'api-left', to: 'api-right' }],
    };

    const presentation = buildPresentationFor({
      doc: localDoc,
      expanded: { 'group-a': true },
    });
    const groupNode = presentation.nodes.find((node) => node.id === 'group-a');
    const leftNode = presentation.nodes.find((node) => node.id === 'api-left');
    const rightNode = presentation.nodes.find((node) => node.id === 'api-right');
    const overlayLocalEdge = presentation.overlayEdges.find(
      (edge) => edge.relationId === 'rel-local',
    );
    const leftRect = leftNode?.rect ?? { x: 0, y: 0, width: 0, height: 0 };
    const rightRect = rightNode?.rect ?? { x: 0, y: 0, width: 0, height: 0 };

    expect(groupNode).toBeDefined();
    expect(leftNode).toBeDefined();
    expect(rightNode).toBeDefined();
    expect(overlayLocalEdge).toBeDefined();

    const expectedOverlayGeometry = buildBezierEdgeGeometry({
      sourceRect: leftRect,
      targetRect: rightRect,
    });

    expect(overlayLocalEdge).toMatchObject({
      relationId: 'rel-local',
      kind: 'routed',
      sourceId: 'api-left',
      targetId: 'api-right',
      solidOverNodeIds: ['group-a'],
    });
    expect(overlayLocalEdge?.geometry).toEqual(expectedOverlayGeometry);
    expect(overlayLocalEdge?.path).toBe(expectedOverlayGeometry.path);
    expect(overlayLocalEdge?.labelAnchor).toEqual(expectedOverlayGeometry.labelAnchor);
  });

  it('keeps descendant cross-group edges routed from their visible endpoints', () => {
    const nestedDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'group-root', type: CORE_GROUP_TYPE_ID, name: 'Root Group' },
        { id: 'group-left', type: CORE_GROUP_TYPE_ID, name: 'Left Group', parent: 'group-root' },
        { id: 'group-right', type: CORE_GROUP_TYPE_ID, name: 'Right Group', parent: 'group-root' },
        { id: 'worker-left', type: WORKER_TYPE_ID, name: 'Worker', parent: 'group-left' },
        { id: 'job-right', type: JOB_TYPE_ID, name: 'Job', parent: 'group-right' },
      ],
      relations: [
        { id: 'rel-nested', type: CALLS_RELATION_ID, from: 'worker-left', to: 'job-right' },
      ],
    };

    const presentation = buildPresentationFor({
      doc: nestedDoc,
      expanded: { 'group-root': true, 'group-left': true, 'group-right': true },
    });
    const rootGroup = presentation.nodes.find((node) => node.id === 'group-root');
    const workerNode = presentation.nodes.find((node) => node.id === 'worker-left');
    const jobNode = presentation.nodes.find((node) => node.id === 'job-right');
    const routedEdge = presentation.overlayEdges.find((edge) => edge.kind === 'routed');

    expect(rootGroup).toBeDefined();
    expect(presentation.overlayEdges).toHaveLength(1);
    expect(routedEdge?.sourceId).toBe('worker-left');
    expect(routedEdge?.targetId).toBe('job-right');

    const expectedGeometry = buildBezierEdgeGeometry({
      sourceRect: workerNode?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      targetRect: jobNode?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
    });

    expect(routedEdge?.geometry).toEqual(expectedGeometry);
    expect(routedEdge?.path).toBe(expectedGeometry.path);
    expect(routedEdge?.labelAnchor).toEqual(expectedGeometry.labelAnchor);
  });

  it('keeps projected same-side routed edges on the shared source handle', () => {
    const sharedSourceDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'group-root', type: CORE_GROUP_TYPE_ID, name: 'Root Group' },
        { id: 'app-source', type: APPLICATION_TYPE_ID, name: 'Source App', parent: 'group-root' },
        { id: 'source-hidden', type: API_TYPE_ID, name: 'Source Hidden', parent: 'app-source' },
        { id: 'app-target', type: APPLICATION_TYPE_ID, name: 'Target App', parent: 'group-root' },
        { id: 'target-a', type: API_TYPE_ID, name: 'Target A', parent: 'app-target' },
        { id: 'target-b', type: API_TYPE_ID, name: 'Target B', parent: 'app-target' },
      ],
      relations: [
        { id: 'rel-a', type: CALLS_RELATION_ID, from: 'source-hidden', to: 'target-a' },
        { id: 'rel-b', type: CALLS_RELATION_ID, from: 'source-hidden', to: 'target-b' },
      ],
    };

    const presentation = buildPresentationFor({
      doc: sharedSourceDoc,
      expanded: { 'group-root': true, 'app-target': true },
    });
    const routedEdges = presentation.overlayEdges
      .filter((edge) => edge.sourceId === 'app-source')
      .sort((left, right) => left.targetId.localeCompare(right.targetId));

    expect(routedEdges).toHaveLength(2);
    expect(routedEdges[0]?.geometry.sourcePoint.x).toBe(routedEdges[1]?.geometry.sourcePoint.x);
    expect(routedEdges[0]?.geometry.sourcePoint.y).toBe(routedEdges[1]?.geometry.sourcePoint.y);
    expect(routedEdges[0]?.path).not.toBe(routedEdges[1]?.path);
    expect(routedEdges[0]?.labelAnchor.y).not.toBe(routedEdges[1]?.labelAnchor.y);
  });

  it('keeps multiple routed edges converged on the shared target handle', () => {
    const sharedTargetDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'group-root', type: CORE_GROUP_TYPE_ID, name: 'Root Group' },
        { id: 'app-left', type: APPLICATION_TYPE_ID, name: 'Left App', parent: 'group-root' },
        { id: 'source-a', type: API_TYPE_ID, name: 'Source A', parent: 'app-left' },
        { id: 'source-b', type: API_TYPE_ID, name: 'Source B', parent: 'app-left' },
        { id: 'target', type: API_TYPE_ID, name: 'Target', parent: 'group-root' },
      ],
      relations: [
        { id: 'rel-a', type: CALLS_RELATION_ID, from: 'source-a', to: 'target' },
        { id: 'rel-b', type: CALLS_RELATION_ID, from: 'source-b', to: 'target' },
      ],
    };

    const presentation = buildPresentationFor({
      doc: sharedTargetDoc,
      expanded: { 'group-root': true, 'app-left': true },
    });
    const targetNode = presentation.nodes.find((node) => node.id === 'target');
    const routedEdges = presentation.overlayEdges
      .filter((edge) => edge.targetId === 'target')
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId));

    expect(targetNode).toBeDefined();
    expect(routedEdges).toHaveLength(2);
    expect(routedEdges[0]?.geometry.targetPoint.x).toBe(routedEdges[1]?.geometry.targetPoint.x);
    expect(routedEdges[0]?.geometry.targetPoint.y).toBe(routedEdges[1]?.geometry.targetPoint.y);
    expect(routedEdges[0]?.geometry.targetPoint.y).toBe(
      targetNode!.rect.y + targetNode!.rect.height / 2,
    );
    expect(routedEdges[0]?.path).not.toBe(routedEdges[1]?.path);
  });

  it('prefers explicit type hue over a shared tag color for node chrome', () => {
    const hueDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'worker-a', type: WORKER_TYPE_ID, name: 'Worker A' },
        { id: 'job-a', type: JOB_TYPE_ID, name: 'Job A' },
      ],
      relations: [],
    };

    const presentation = buildPresentationFor({
      doc: hueDoc,
    });
    const worker = presentation.nodes.find((node) => node.id === 'worker-a');
    const job = presentation.nodes.find((node) => node.id === 'job-a');

    expect(worker?.content.primaryTagLabel).toBe('Interaction');
    expect(job?.content.primaryTagLabel).toBe('Interaction');
    expect(worker?.content.primaryTagHue).toBe(0);
    expect(job?.content.primaryTagHue).toBe(0);
    expect(worker?.style.background).toContain(
      'hsla(32, var(--node-bg-s, 38%), var(--node-bg-l, 16%)',
    );
    expect(job?.style.background).toContain(
      'hsla(278, var(--node-bg-s, 38%), var(--node-bg-l, 16%)',
    );
  });

  it('colors mixed groups from the majority immediate child type when child tags match', () => {
    const mixedGroupDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'runtime',
          type: CORE_GROUP_TYPE_ID,
          name: 'Runtime',
          props: { mode: 'mixed' },
          children: [
            { id: 'worker-a', type: WORKER_TYPE_ID, name: 'Worker A' },
            { id: 'job-a', type: JOB_TYPE_ID, name: 'Job A' },
            { id: 'job-b', type: JOB_TYPE_ID, name: 'Job B' },
          ],
        },
      ],
      relations: [],
    };

    const presentation = buildPresentationFor({
      doc: mixedGroupDoc,
      expanded: { runtime: true },
    });
    const runtime = presentation.nodes.find((node) => node.id === 'runtime');

    expect(runtime?.content.primaryTagLabel).toBe('Interaction');
    expect(runtime?.content.primaryTagHue).toBe(0);
    expect(runtime?.style.background).toContain(
      'hsla(278, var(--node-bg-s, 38%), var(--node-bg-l-group, 18%)',
    );
  });

  it('renders fallback labels for nameless list items but not cards', () => {
    const namelessDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'app-a',
          type: APPLICATION_TYPE_ID,
          name: 'App A',
          children: [
            { id: 'api-a', type: API_TYPE_ID },
            { id: 'api-b', type: API_TYPE_ID },
          ],
        },
        { id: 'api-top', type: API_TYPE_ID },
      ],
      relations: [],
    };

    const presentation = buildPresentationFor({
      doc: namelessDoc,
      expanded: { 'app-a': true },
    });

    const apiA = presentation.nodes.find((node) => node.id === 'api-a');
    const apiB = presentation.nodes.find((node) => node.id === 'api-b');
    const apiTop = presentation.nodes.find((node) => node.id === 'api-top');
    expect(apiA?.content.listMode).toBe(true);
    expect(apiA?.content.label).toBe('Unnamed API');
    expect(apiB?.content.label).toBe('Unnamed API');
    expect(apiTop?.content.listMode).toBe(false);
    expect(apiTop?.content.label).toBe('');
  });

  it('keeps projected props out of final card nodes and their sizing', () => {
    const withProps: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'svc-a',
          type: SERVICE_TYPE_ID,
          name: 'Service A',
          props: { region: 'eu-west-2', replicas: 2 },
        },
      ],
      relations: [],
    };
    const withoutProps: SemanticDocument = {
      ...withProps,
      entities: [{ id: 'svc-a', type: SERVICE_TYPE_ID, name: 'Service A' }],
    };

    const serviceWithProps = buildPresentationFor({ doc: withProps }).nodes.find(
      (node) => node.id === 'svc-a',
    );
    const serviceWithoutProps = buildPresentationFor({ doc: withoutProps }).nodes.find(
      (node) => node.id === 'svc-a',
    );

    expect(serviceWithProps?.content.badges).toEqual([]);
    expect(serviceWithProps?.rect.height).toBe(serviceWithoutProps?.rect.height);
  });

  it('keeps projected props out of final list nodes and their sizing', () => {
    const withProps: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'runtime', type: CORE_GROUP_TYPE_ID, name: 'Runtime' },
        {
          id: 'svc-a',
          type: SERVICE_TYPE_ID,
          name: 'Service A',
          parent: 'runtime',
          props: { region: 'eu-west-2', replicas: 2 },
        },
        {
          id: 'svc-b',
          type: SERVICE_TYPE_ID,
          name: 'Service B',
          parent: 'runtime',
          props: { region: 'eu-west-2', replicas: 3 },
        },
      ],
      relations: [],
    };
    const withoutProps: SemanticDocument = {
      ...withProps,
      entities: [
        { id: 'runtime', type: CORE_GROUP_TYPE_ID, name: 'Runtime' },
        { id: 'svc-a', type: SERVICE_TYPE_ID, name: 'Service A', parent: 'runtime' },
        { id: 'svc-b', type: SERVICE_TYPE_ID, name: 'Service B', parent: 'runtime' },
      ],
    };

    const listPresentationWithProps = buildPresentationFor({
      doc: withProps,
      expanded: { runtime: true },
    });
    const listPresentationWithoutProps = buildPresentationFor({
      doc: withoutProps,
      expanded: { runtime: true },
    });
    const serviceWithProps = listPresentationWithProps.nodes.find((node) => node.id === 'svc-a');
    const serviceWithoutProps = listPresentationWithoutProps.nodes.find(
      (node) => node.id === 'svc-a',
    );

    expect(serviceWithProps?.content.listMode).toBe(true);
    expect(serviceWithProps?.content.listProps).toEqual([]);
    expect(serviceWithProps?.rect.height).toBe(serviceWithoutProps?.rect.height);
  });

  it('forwards semantic control state into static host snapshots', () => {
    const presentation = buildPresentationFor({
      expanded: { 'app-a': true },
    });

    const appNode = presentation.nodes.find((node) => node.id === 'app-a');
    expect(appNode?.controls.showZoomControls).toBe(true);
    expect(appNode?.controls.canZoomIn).toBe(false);
    expect(appNode?.controls.canZoomOut).toBe(true);
    expect(appNode?.controls.showDetailControls).toBe(true);
  });

  it('projects rich content payloads onto note-style entity cards', () => {
    const noteDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'tour-note',
          type: NOTE_TYPE_ID,
          name: 'What the app is doing',
          props: {
            body: 'A **schema** defines the vocabulary.',
          },
        },
      ],
      relations: [],
    };

    const presentation = buildPresentationFor({
      doc: noteDoc,
    });

    expect(presentation.nodes[0]?.content.richContent).toEqual({
      kind: 'markdown',
      markdown: 'A **schema** defines the vocabulary.',
    });
  });

  it('colors typed groups from groupType and mixed groups from semantic children', () => {
    const groupDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'app-a',
          type: APPLICATION_TYPE_ID,
          name: 'App A',
          children: [
            {
              id: 'typed-tables',
              type: CORE_GROUP_TYPE_ID,
              name: 'Tables',
              props: { mode: 'typed', groupType: TABLE_TYPE_ID },
              children: [{ id: 'orders', type: TABLE_TYPE_ID, name: 'orders' }],
            },
            {
              id: 'mixed-runtime',
              type: CORE_GROUP_TYPE_ID,
              name: 'Runtime',
              props: { mode: 'mixed' },
              children: [{ id: 'api-a', type: API_TYPE_ID, name: 'API A' }],
            },
          ],
        },
      ],
      relations: [],
    };

    const presentation = buildPresentationFor({
      doc: groupDoc,
      expanded: {
        'app-a': true,
        'typed-tables': true,
        'mixed-runtime': true,
      },
    });

    const typedGroup = presentation.nodes.find((node) => node.id === 'typed-tables');
    const mixedGroup = presentation.nodes.find((node) => node.id === 'mixed-runtime');

    expect(typedGroup?.content.primaryTagLabel).toBe('Data');
    expect(typedGroup?.content.entityType).toBe('Table Group');
    expect(typedGroup?.content.summaryLabel).toBe('1 table');
    expect(typedGroup?.style.background).toContain(
      'hsla(120, var(--node-bg-s, 38%), var(--node-bg-l-group, 18%)',
    );
    expect(mixedGroup?.content.primaryTagLabel).toBe('Interaction');
    expect(mixedGroup?.style.background).toContain(
      'hsla(0, var(--node-bg-s, 38%), var(--node-bg-l-group, 18%)',
    );
  });

  it('keeps mixed-group visual identity stable when collapsed and expanded', () => {
    const mixedGroupDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'data-platform',
          type: CORE_GROUP_TYPE_ID,
          name: 'Data Platform',
          props: { mode: 'mixed' },
          children: [{ id: 'orders', type: TABLE_TYPE_ID, name: 'orders' }],
        },
      ],
      relations: [],
    };

    const collapsedNode = buildPresentationFor({
      doc: mixedGroupDoc,
    }).nodes.find((node) => node.id === 'data-platform');
    const expandedNode = buildPresentationFor({
      doc: mixedGroupDoc,
      expanded: { 'data-platform': true },
    }).nodes.find((node) => node.id === 'data-platform');

    expect(collapsedNode?.content.primaryTagLabel).toBe('Data');
    expect(expandedNode?.content.primaryTagLabel).toBe('Data');
    expect(collapsedNode?.style.background).toBe(expandedNode?.style.background);
  });

  it('renders focus scaffold groups as transparent boundary shells', () => {
    const focusDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'ordersdb', type: APPLICATION_TYPE_ID, name: 'Orders DB' },
        {
          id: 'table-group',
          type: CORE_GROUP_TYPE_ID,
          name: 'Core tables',
          parent: 'ordersdb',
        },
        {
          id: 'orders',
          type: TABLE_TYPE_ID,
          name: 'orders',
          parent: 'table-group',
        },
        {
          id: 'customers',
          type: TABLE_TYPE_ID,
          name: 'customers',
          parent: 'table-group',
        },
      ],
      relations: [],
    };
    const viewDoc = withView(focusDoc, { scopeRootId: 'ordersdb' });
    const { graph, scene } = buildScene(viewDoc, { width: 1600, height: 900 });
    const presentation = buildStaticCanvasPresentation({
      graph,
      scene,
    });

    const shell = presentation.nodes.find((node) => node.id === 'table-group');
    expect(shell?.content.focusShell).toBe(true);
    expect(shell?.style.focusShell).toBe(true);
    expect(shell?.style.background).toBe('transparent');
    expect(shell?.style.border).toBe('1px solid transparent');
  });
});
