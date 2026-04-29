import { describe, expect, it } from 'vitest';
import type { SchemaModule, SemanticDocument } from '../model/types';
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

  it('computes semantic node controls from expanded state and visible child-parent structure', () => {
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

    const platformControls = tree.byId.get('platform')?.view.controls;
    expect(platformControls?.showZoomControls).toBe(true);
    expect(platformControls?.canZoomIn).toBe(false);
    expect(platformControls?.canZoomOut).toBe(true);
    expect(platformControls?.showDetailControls).toBe(true);
    expect(platformControls?.canExpandDetails).toBe(true);
    expect(platformControls?.canCollapseDetails).toBe(true);
    expect(platformControls?.showChildGroupControls).toBe(true);
    expect(platformControls?.canExpandChildGroups).toBe(true);
    expect(platformControls?.canCollapseChildGroups).toBe(false);
  });

  it('disables child-group collapse controls when no visible child parent is expanded', () => {
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

    const workersControls = tree.byId.get('workers')?.view.controls;
    expect(workersControls?.showZoomControls).toBe(true);
    expect(workersControls?.canZoomIn).toBe(true);
    expect(workersControls?.canZoomOut).toBe(false);
    expect(workersControls?.showChildGroupControls).toBe(false);
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
        semanticSourceId: 'orders',
        semanticTargetId: 'job',
        type: 'calls',
        label: 'calls',
        solidOverNodeIds: ['table-group', 'database', 'platform', 'workers'],
      }),
    ]);
  });

  it('keeps solid-over ownership tied to semantic endpoints when projected endpoints collapse upward', () => {
    const state = compileDiagramViewState({
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

    expect(state.edges).toEqual([
      expect.objectContaining({
        id: 'rel-1:database->workers',
        relationId: 'rel-1',
        sourceId: 'database',
        targetId: 'workers',
        semanticSourceId: 'orders',
        semanticTargetId: 'job',
        solidOverNodeIds: ['database', 'platform', 'workers'],
      }),
    ]);
  });

  it('never assigns unrelated sibling branches to solid-over ownership', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'checkout', type: 'group' },
        { id: 'notifications', type: 'leaf', parent: 'checkout' },
        { id: 'external', type: 'group' },
        { id: 'email', type: 'leaf', parent: 'external' },
        { id: 'fulfillment', type: 'group' },
        { id: 'picking', type: 'leaf', parent: 'fulfillment' },
      ],
      relations: [{ id: 'rel-1', type: 'calls', from: 'notifications', to: 'email' }],
      view: {
        kind: 'semantic-diagram-view',
        version: 2,
        nodesById: {
          checkout: { expanded: true },
          external: { expanded: true },
          fulfillment: { expanded: true },
        },
      },
    };

    const state = compileDiagramViewState({ doc, schema });

    expect(state.edges).toEqual([
      expect.objectContaining({
        relationId: 'rel-1',
        sourceId: 'notifications',
        targetId: 'email',
        solidOverNodeIds: ['checkout', 'external'],
      }),
    ]);
    expect(state.edges[0]?.solidOverNodeIds).not.toContain('fulfillment');
    expect(state.edges[0]?.solidOverNodeIds).not.toContain('picking');
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
