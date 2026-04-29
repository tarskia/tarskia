import { describe, expect, it } from 'vitest';
import type { SchemaModule, SemanticDocument } from '../../../model/types';
import { compileDiagramViewState } from '../../../semantic';
import { buildGraphModel } from '../graph/graph-model';
import { getGroupHeaderHeight } from './component-renderer';
import { buildLayoutResult } from './layout-pipeline';

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  types: [
    {
      id: 'datastore',
      label: 'Datastore',
      display: {
        defaultSize: { width: 220, height: 140 },
        count: { childTypes: ['table'], label: 'tables' },
      },
    },
    {
      id: 'table',
      label: 'Table',
      defaultTags: ['data'],
      display: { defaultSize: { width: 140, height: 80 } },
    },
    {
      id: 'table-group',
      label: 'Table Group',
      display: { defaultSize: { width: 180, height: 120 } },
    },
    {
      id: 'note',
      label: 'Note',
      display: {
        defaultSize: { width: 320, height: 220 },
        content: { kind: 'markdown', bodyPath: 'body' },
      },
      properties: [{ id: 'body', type: 'string' }],
    },
  ],
  relations: [
    {
      id: 'consumes',
      label: 'consumes',
      display: {
        flowDirection: 'reverse',
      },
    },
  ],
};

const buildDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'db', type: 'datastore', name: 'Orders DB' },
    { id: 't1', type: 'table', name: 'orders', parent: 'db' },
  ],
  relations: [],
});

const buildMixedDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'db', type: 'datastore', name: 'Orders DB' },
    { id: 'tg', type: 'table-group', name: 'orders', parent: 'db' },
    { id: 't1', type: 'table', name: 'orders', parent: 'db' },
    { id: 't2', type: 'table', name: 'line_items', parent: 'tg' },
  ],
  relations: [],
});

const buildLeafListDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'db', type: 'datastore', name: 'Orders DB' },
    { id: 't1', type: 'table', name: 'orders', parent: 'db' },
    { id: 't2', type: 'table', name: 'customers', parent: 'db' },
  ],
  relations: [],
});

const buildLeafGraphDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'db', type: 'datastore', name: 'Orders DB' },
    { id: 't1', type: 'table', name: 'orders', parent: 'db' },
    { id: 't2', type: 'table', name: 'customers', parent: 'db' },
  ],
  relations: [{ id: 'r1', type: 'joins', from: 't1', to: 't2' }],
});

const buildBulkControlsDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'svc', type: 'datastore', name: 'Service' },
    { id: 'api-group', type: 'table-group', name: 'api', parent: 'svc' },
    {
      id: 'workers-group',
      type: 'table-group',
      name: 'workers',
      parent: 'svc',
    },
    { id: 'api-leaf', type: 'table', name: 'createOrder', parent: 'api-group' },
    {
      id: 'worker-leaf',
      type: 'table',
      name: 'orderProcessor',
      parent: 'workers-group',
    },
  ],
  relations: [],
});

const buildContentChildrenDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'tour', type: 'datastore', name: 'Tour' },
    {
      id: 'note-a',
      type: 'note',
      name: 'Step A',
      parent: 'tour',
      props: { body: 'First step' },
    },
    {
      id: 'note-b',
      type: 'note',
      name: 'Step B',
      parent: 'tour',
      props: { body: 'Second step' },
    },
  ],
  relations: [],
});

const buildLongContentDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    {
      id: 'tour-note',
      type: 'note',
      name: 'Core model',
      props: {
        body: [
          'Tarskia is not just drawing boxes and arrows.',
          '',
          '- A **schema** says which types, relations, and display hints are allowed.',
          '- A **document** is the concrete system you are diagramming.',
          '- A **view** decides which branches are expanded right now.',
          '',
          'The same diagram can move between high-level architecture and low-level detail without losing meaning.',
        ].join('\n'),
      },
    },
  ],
  relations: [],
});

const buildReverseFlowDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'publisher', type: 'table', name: 'Publisher' },
    { id: 'queue', type: 'datastore', name: 'Queue' },
    { id: 'subscriber', type: 'table', name: 'Subscriber' },
  ],
  relations: [{ id: 'r-flow', type: 'consumes', from: 'subscriber', to: 'queue' }],
});

const buildSiblingDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'left', type: 'table', name: 'Left' },
    { id: 'right', type: 'table', name: 'Right' },
  ],
  relations: [],
});

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

const buildTestLayout = (doc: SemanticDocument, canvasSize?: { width: number; height: number }) => {
  const graph = buildGraphModel(doc, schema);
  const viewState = compileDiagramViewState({ doc, schema });
  return buildLayoutResult({ graph, viewState, layout: doc.view?.layout, canvasSize });
};

describe('buildLayoutResult', () => {
  it('omits nested children when parent is collapsed', () => {
    const layout = buildTestLayout(buildDoc());

    expect(layout.visibleIds.has('db')).toBe(true);
    expect(layout.visibleIds.has('t1')).toBe(false);
    expect(layout.tree.byId.has('t1')).toBe(false);
  });

  it('includes nested children when parent is expanded', () => {
    const layout = buildTestLayout(withView(buildDoc(), { expanded: { db: true } }));

    expect(layout.visibleIds.has('db')).toBe(true);
    expect(layout.visibleIds.has('t1')).toBe(true);
    const child = layout.tree.byId.get('t1');
    expect(child).toBeDefined();
    expect(child?.position).toBeDefined();
  });

  it('reverses layout flow for relations configured with reverse visual direction', () => {
    const layout = buildTestLayout(buildReverseFlowDoc());

    expect(layout.edges).toEqual([
      expect.objectContaining({
        id: 'r-flow:subscriber->queue',
        relationId: 'r-flow',
        semanticSourceId: 'subscriber',
        semanticTargetId: 'queue',
        sourceId: 'queue',
        targetId: 'subscriber',
      }),
    ]);

    expect(
      (layout.absolutePositions.queue?.x ?? 0) < (layout.absolutePositions.subscriber?.x ?? 0),
    ).toBe(true);
  });

  it('treats semantic view node paint order as the z-index source of truth', () => {
    const doc = buildSiblingDoc();
    const graph = buildGraphModel(doc, schema);
    const viewState = compileDiagramViewState({ doc, schema });
    const layout = buildLayoutResult({
      graph,
      viewState: {
        ...viewState,
        nodePaintOrder: ['right', 'left'],
      },
    });

    expect(layout.zIndexById.get('left')).toBeGreaterThan(layout.zIndexById.get('right') ?? 0);
  });

  it('does not use list mode for single-child containers', () => {
    const layout = buildTestLayout(withView(buildDoc(), { expanded: { db: true } }));

    const parent = layout.tree.byId.get('db');
    expect(parent?.layoutMode).toBe('graph');
  });

  it('does not use list mode when any visible child is a non-leaf in the full tree', () => {
    const layout = buildTestLayout(withView(buildMixedDoc(), { expanded: { db: true } }));

    const parent = layout.tree.byId.get('db');
    expect(parent?.layoutMode).toBe('graph');
  });

  it('uses list mode when container has multiple structural leaf children with no internal edges', () => {
    const layout = buildTestLayout(withView(buildLeafListDoc(), { expanded: { db: true } }));

    const parent = layout.tree.byId.get('db');
    expect(parent?.layoutMode).toBe('list');
    expect(parent?.summaryLabel).toBe('2 tables');
  });

  it('does not use list mode when container children have internal edges', () => {
    const layout = buildTestLayout(withView(buildLeafGraphDoc(), { expanded: { db: true } }));

    const parent = layout.tree.byId.get('db');
    expect(parent?.layoutMode).toBe('graph');
  });

  it('does not use list mode for rich-content leaf children', () => {
    const layout = buildTestLayout(
      withView(buildContentChildrenDoc(), { expanded: { tour: true } }),
    );

    const parent = layout.tree.byId.get('tour');
    expect(parent?.layoutMode).toBe('graph');
  });

  it('grows markdown note nodes beyond their default height when content needs it', () => {
    const layout = buildTestLayout(buildLongContentDoc());

    const note = layout.tree.byId.get('tour-note');
    expect(note).toBeDefined();
    expect(note?.size.height ?? 0).toBeGreaterThan(260);
    expect(note?.size.height ?? 0).toBeGreaterThan(note?.baseSize.height ?? 0);
  });

  it('keeps authored summary labels on the laid-out scene tree', () => {
    const layout = buildTestLayout(withView(buildDoc(), { expanded: { db: true } }));

    const parent = layout.tree.byId.get('db');
    expect(parent?.summaryLabel).toBe('1 table');
    expect(layout.nodeVisuals.get('db')?.projection.summaryLabel).toBe('1 table');
  });

  it('adds extra spacing between the count pill and children', () => {
    const layout = buildTestLayout(withView(buildDoc(), { expanded: { db: true } }));

    const parent = layout.tree.byId.get('db');
    const child = layout.tree.byId.get('t1');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    const headerHeight = getGroupHeaderHeight(0);
    const padding = 16;
    const childGap = 10;
    const minY = headerHeight + padding + childGap;
    expect(child?.position?.y ?? 0).toBeGreaterThanOrEqual(minY);
  });

  it('reserves bulk controls row space when parent has >=2 child-parents', () => {
    const layout = buildTestLayout(
      withView(buildBulkControlsDoc(), {
        expanded: { svc: true, 'api-group': true },
      }),
    );

    const firstChild = layout.tree.byId.get('api-group');
    const secondChild = layout.tree.byId.get('workers-group');
    expect(firstChild).toBeDefined();
    expect(secondChild).toBeDefined();
    const headerHeight = getGroupHeaderHeight(0, true);
    const padding = 16;
    const childGap = 10;
    const minY = headerHeight + padding + childGap;
    expect(firstChild?.position?.y ?? 0).toBeGreaterThanOrEqual(minY);
    expect(secondChild?.position?.y ?? 0).toBeGreaterThanOrEqual(minY);
  });

  it('scopes visible ids to the focused subtree', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'svc', type: 'datastore', name: 'Service' },
        {
          id: 'api-group',
          type: 'table-group',
          name: 'API Group',
          parent: 'svc',
        },
        {
          id: 'worker-group',
          type: 'table-group',
          name: 'Worker Group',
          parent: 'svc',
        },
        {
          id: 'api-leaf',
          type: 'table',
          name: 'Create order',
          parent: 'api-group',
        },
        {
          id: 'worker-leaf',
          type: 'table',
          name: 'Process order',
          parent: 'worker-group',
        },
      ],
      relations: [],
    };
    const layout = buildTestLayout(
      withView(doc, {
        expanded: { svc: true, 'api-group': true, 'worker-group': true },
        scopeRootId: 'api-group',
      }),
    );

    expect(layout.visibleIds.has('svc')).toBe(false);
    expect(layout.visibleIds.has('api-group')).toBe(false);
    expect(layout.visibleIds.has('api-leaf')).toBe(true);
    expect(layout.visibleIds.has('worker-group')).toBe(false);
    expect(layout.visibleIds.has('worker-leaf')).toBe(false);
  });

  it('forces expansion through a single-child chain until the first branch point', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'platform', type: 'datastore', name: 'Data platform' },
        {
          id: 'database',
          type: 'table-group',
          name: 'Warehouse DB',
          parent: 'platform',
        },
        {
          id: 'table-group',
          type: 'table-group',
          name: 'Analytics tables',
          parent: 'database',
        },
        { id: 'orders', type: 'table', name: 'orders', parent: 'table-group' },
        {
          id: 'customers',
          type: 'table',
          name: 'customers',
          parent: 'table-group',
        },
      ],
      relations: [],
    };
    const layout = buildTestLayout(
      withView(doc, {
        scopeRootId: 'platform',
      }),
      { width: 1600, height: 900 },
    );

    expect(layout.visibleIds.has('platform')).toBe(false);
    expect(layout.visibleIds.has('database')).toBe(true);
    expect(layout.visibleIds.has('table-group')).toBe(true);
    expect(layout.visibleIds.has('orders')).toBe(true);
    expect(layout.visibleIds.has('customers')).toBe(true);
    const database = layout.tree.byId.get('database');
    const tableGroup = layout.tree.byId.get('table-group');
    expect(database?.size.width ?? 0).toBeGreaterThan(1500);
    expect(database?.size.height ?? 0).toBeGreaterThan(850);
    expect(tableGroup?.size.width ?? 0).toBeGreaterThan(1300);
    expect(tableGroup?.size.height ?? 0).toBeGreaterThan(750);
    expect((database?.size.width ?? 0) - (tableGroup?.size.width ?? 0)).toBeGreaterThan(100);
  });

  it('lets the descended focus shell fill the viewport aspect instead of shrinking to its content', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'ordersdb', type: 'datastore', name: 'Orders DB' },
        {
          id: 'table-group',
          type: 'table-group',
          name: 'Core tables',
          parent: 'ordersdb',
        },
        { id: 'orders', type: 'table', name: 'orders', parent: 'table-group' },
        {
          id: 'customers',
          type: 'table',
          name: 'customers',
          parent: 'table-group',
        },
      ],
      relations: [{ id: 'rel-1', type: 'joins', from: 'orders', to: 'customers' }],
    };
    const layout = buildTestLayout(
      withView(doc, {
        scopeRootId: 'ordersdb',
      }),
      { width: 1600, height: 900 },
    );

    const tableGroup = layout.tree.byId.get('table-group');
    expect(tableGroup).toBeDefined();
    expect(tableGroup?.size.width ?? 0).toBeGreaterThan(1500);
    expect(tableGroup?.size.height ?? 0).toBeGreaterThan(850);
    expect(
      (tableGroup?.size.width ?? 0) / Math.max(1, tableGroup?.size.height ?? 1),
    ).toBeGreaterThan(1.6);
  });
});
