import { describe, expect, it } from 'vitest';
import type { SchemaModule, SemanticDocument } from '../../model/types';
import { compileDiagramViewState, compileDiagramViewTree } from './compile-diagram-view-tree';

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  types: [
    {
      id: 'group',
      label: 'Group',
    },
    {
      id: 'leaf',
      label: 'Leaf',
      defaultTags: ['data'],
    },
  ],
  relations: [],
};

const buildDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'platform', type: 'group' },
    { id: 'database', type: 'group', parent: 'platform' },
    { id: 'table-group', type: 'group', parent: 'database' },
    { id: 'orders', type: 'leaf', parent: 'table-group' },
    { id: 'customers', type: 'leaf', parent: 'table-group' },
    { id: 'workers', type: 'group', parent: 'platform' },
    { id: 'job', type: 'leaf', parent: 'workers' },
  ],
  relations: [{ id: 'rel-1', type: 'calls', from: 'orders', to: 'job' }],
});

describe('compileDiagramViewTree', () => {
  it('defaults to the top-level visible tree when no view state is present', () => {
    const tree = compileDiagramViewTree({ doc: buildDoc(), schema });

    expect(tree.byId.has('platform')).toBe(true);
    expect(tree.byId.has('database')).toBe(false);
    expect(tree.byId.has('workers')).toBe(false);
  });

  it('reveals descendants when nodes are expanded in the saved view', () => {
    const tree = compileDiagramViewTree({
      doc: {
        ...buildDoc(),
        view: {
          kind: 'semantic-diagram-view',
          version: 2,
          nodesById: {
            platform: { expanded: true },
            database: { expanded: true },
            'table-group': { expanded: true },
          },
        },
      },
      schema,
    });

    expect(tree.byId.has('database')).toBe(true);
    expect(tree.byId.has('table-group')).toBe(true);
    expect(tree.byId.has('orders')).toBe(true);
    expect(tree.byId.get('platform')?.view.expanded).toBe(true);
  });

  it('scopes to the saved scope root and annotates the forced single-child chain', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'platform', type: 'group' },
        { id: 'database', type: 'group', parent: 'platform' },
        { id: 'table-group', type: 'group', parent: 'database' },
        { id: 'orders', type: 'leaf', parent: 'table-group' },
        { id: 'customers', type: 'leaf', parent: 'table-group' },
      ],
      relations: [],
      view: {
        kind: 'semantic-diagram-view',
        version: 2,
        scopeRootId: 'platform',
      },
    };
    const tree = compileDiagramViewTree({
      doc,
      schema,
    });

    expect(tree.byId.has('platform')).toBe(false);
    expect(tree.byId.has('database')).toBe(true);
    expect(tree.byId.has('table-group')).toBe(true);
    expect(tree.byId.has('orders')).toBe(true);
    expect(tree.byId.get('database')?.view.focusChainDepth).toBe(0);
    expect(tree.byId.get('table-group')?.view.focusChainDepth).toBe(1);
  });

  it('records structural flags from the canonical diagram tree', () => {
    const tree = compileDiagramViewTree({
      doc: {
        ...buildDoc(),
        view: {
          kind: 'semantic-diagram-view',
          version: 2,
          nodesById: {
            platform: { expanded: true },
          },
        },
      },
      schema,
    });

    expect(tree.byId.get('database')?.hasDiagramChildren).toBe(true);
    expect(tree.byId.get('database')?.view.isOnlyChild).toBe(false);
    expect(tree.byId.get('workers')?.view.isOnlyChild).toBe(false);
  });

  it('supports minimal-closure reveal targets via optional compiler inputs', () => {
    const tree = compileDiagramViewTree({
      doc: {
        ...buildDoc(),
        view: {
          kind: 'semantic-diagram-view',
          version: 2,
          nodesById: {
            platform: { expanded: true },
            database: { expanded: true },
            'table-group': { expanded: true },
          },
        },
      },
      schema,
      targetEntityIds: new Set(['orders']),
      forceRevealTargets: true,
      preserveExpandedBranches: true,
    });

    expect(tree.byId.has('orders')).toBe(true);
    expect(tree.byId.get('orders')?.view.reveal.isTarget).toBe(true);
    expect(tree.byId.has('customers')).toBe(true);
    expect(tree.byId.get('customers')?.view.reveal.isPreservedByExpansion).toBe(true);
    expect(tree.byId.has('job')).toBe(false);
  });

  it('emits compiled edges keyed to rendered node ids', () => {
    const state = compileDiagramViewState({
      doc: {
        ...buildDoc(),
        view: {
          kind: 'semantic-diagram-view',
          version: 2,
          nodesById: {
            platform: { expanded: true },
            database: { expanded: true },
            'table-group': { expanded: true },
          },
        },
      },
      schema,
    });

    expect(state.edges).toEqual([
      expect.objectContaining({
        id: 'rel-1:orders->workers',
        relationId: 'rel-1',
        sourceId: 'orders',
        targetId: 'workers',
        type: 'calls',
        label: 'calls',
      }),
    ]);
  });

  it('emits node paint order from the projected semantic view tree', () => {
    const state = compileDiagramViewState({
      doc: {
        ...buildDoc(),
        view: {
          kind: 'semantic-diagram-view',
          version: 2,
          nodesById: {
            platform: { expanded: true },
            database: { expanded: true },
            'table-group': { expanded: true },
          },
        },
      },
      schema,
    });

    expect(state.nodePaintOrder).toEqual([
      'platform',
      'database',
      'table-group',
      'orders',
      'customers',
      'workers',
    ]);
  });

  it('drops compiled edges when both endpoints collapse to the same rendered node', () => {
    const state = compileDiagramViewState({
      doc: buildDoc(),
      schema,
    });

    expect(state.edges).toEqual([]);
  });
});
